import express from "express";
import cors from "cors";
import fs from "fs";
import serveIndex from "serve-index";
import path from "path";
import fromDot from "ngraph.fromdot";
import createGraph, { Graph, Link, Node } from "ngraph.graph";
import toDot from "ngraph.todot";
import * as d from "d3-delaunay";
import createLayout, { Layout } from "ngraph.forcelayout";
import { parse } from "csv-parse/sync";
import * as d3 from "d3";
import * as turf from "@turf/turf";
import { gen4col } from "./four_color";
import { fileURLToPath } from "url";
import { join } from "path";
import { execSync } from "child_process";
import type { Feature, Polygon, GeoJsonProperties } from "geojson";
import lz4 from "lz4js";
import pako from "pako";
const app = express();
const port = 3010;
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, "data");
app.use("/data", serveIndex(htmlPath));
app.use("/data", express.static(htmlPath));

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

app.get("/compress", (_req, res) => {
  fs.readdirSync("./data/v3/compressedGraphs").forEach((file) => {
    fs.unlinkSync(path.join("./data/v3/compressedGraphs", file));
  });

  for (let i = 0; i <= 31 - 1; i++) {
    console.log(`Loading extended subgraph ${i}`);
    const data = fs.readFileSync("./data/v3/extendedGraphs/" + i + ".dot");
    const compressed = Buffer.from(pako.deflate(data));
    fs.writeFileSync("./data/v3/compressedGraphs/" + i + ".gzip", compressed);
  }

  res.send("Done Compressing");
});

app.get("/egraph", (_req, res) => {
  fs.readdirSync("./data/v3/extendedGraphs").forEach((file) => {
    fs.unlinkSync(path.join("./data/v3/extendedGraphs", file));
  });
  const input = fs.readFileSync("./input/bgg_GameItem.csv", "utf8");
  const records: GameRecord[] = parse(input, {
    columns: true,
    skip_empty_lines: true,
  });

  const gameDataMap = new Map(
    records.map((record) => [record["bgg_id"], record]),
  );
  const inputSubgraphs = [];
  for (let i = 0; i <= 31 - 1; i++) {
    console.log(`Loading extended subgraph ${i}`);
    const graph: Graph<NodeInputData, LinkData> = fromDot(
      fs.readFileSync("./extendedGraph/subgraph_" + i + ".dot").toString(),
    );
    inputSubgraphs.push(graph);
  }
  const enrichedSubgraphs: Graph<NodeData, LinkData>[] = inputSubgraphs.map(
    (graph) => enrichGraphs(graph, gameDataMap),
  );

  const layoutsubgraphs: Graph<NodeInputData, LinkData> = fromDot(
    fs.readFileSync(join("data", "v3", "graphs", `graph.dot`)).toString(),
  );
  const nodeLayoutDict: { [id: string]: string } = {};

  layoutsubgraphs.forEachNode((node) => {
    nodeLayoutDict[node.data.id] = node.data.pos;
  });

  for (let i = 0; i <= 31 - 1; i++) {
    enrichedSubgraphs[i].forEachNode((node) => {
      node.data.pos = nodeLayoutDict[node.data.id];
    });
  }

  enrichedSubgraphs.forEach((subgraph, i) => {
    fs.writeFileSync(
      join("data", "v3", "extendedGraphs", `${i}.dot`),
      toDot(subgraph),
    );
  });
  res.send("Done Rendering");
});

app.get("/render", (_req, res) => {
  fs.readdirSync("./data/v3/geojson").forEach((file) => {
    fs.unlinkSync(path.join("./data/v3/geojson", file));
  });
  fs.readdirSync("./data/v3/graphs").forEach((file) => {
    fs.unlinkSync(path.join("./data/v3/graphs", file));
  });
  fs.readdirSync("./data/v3/names").forEach((file) => {
    fs.unlinkSync(path.join("./data/v3/names", file));
  });
  fs.readdirSync("./data/v3/points").forEach((file) => {
    const curPath = path.join("./data/v3/points", file);
    if (fs.lstatSync(curPath).isDirectory()) {
      fs.rmSync(curPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(curPath);
    }
  });

  const graph: Graph<NodeInputData, LinkData> = fromDot(
    fs.readFileSync("./input/graph.dot").toString(),
  );

  const subgraphs = createSubgraphCluster(graph);

  const input = fs.readFileSync("./input/bgg_GameItem.csv", "utf8");
  const records: GameRecord[] = parse(input, {
    columns: true,
    skip_empty_lines: true,
  });

  const gameDataMap = new Map(
    records.map((record) => [record["bgg_id"], record]),
  );

  const enrichedSubgraphs = enrichGraphs(subgraphs, gameDataMap);

  fs.writeFileSync(
    join("data", "v3", "graphs", `graph.dot`),
    toDot(enrichedSubgraphs),
  );
  const arrays = computeSearchIndexes(enrichedSubgraphs, gameDataMap);
  arrays.forEach((gamelist) => {
    fs.writeFileSync(
      join(
        "data",
        "v3",
        "names",
        gamelist[0].Name.toString()[0].toLowerCase() + ".json",
      ),
      JSON.stringify(
        gamelist.map((element) => [
          element.Name,
          parseFloat(element.x),
          parseFloat(element.y),
          element.id,
          element.year,
        ]),
      ),
    );
  });

  const points = writeGeojson(enrichedSubgraphs);
  fs.writeFileSync("./data/v3/geojson/points.geojson", JSON.stringify(points));

  execSync(
    "tippecanoe --no-tile-compression -zg --drop-densest-as-needed --extend-zooms-if-still-dropping --output-to-directory data/v3/points data/v3/geojson/points.geojson --force",
  );

  const borders = writeVoronoi(enrichedSubgraphs);
  fs.writeFileSync("./data/v3/borders.geojson", JSON.stringify(borders));

  res.send("Done Rendering");
});

function createSubgraphCluster(
  inputGraph: Graph<NodeInputData, LinkData>,
): Graph<NodeInputData, LinkData> {
  const nodes: { x: number; y: number }[] = [];
  inputGraph.forEachNode((node) => {
    const [x, y] = node.data.pos.split(",").map(parseFloat);
    nodes.push({ x, y });
  });

  const max_x = Math.max(...nodes.map((node) => node.x));
  const max_y = Math.max(...nodes.map((node) => node.y));
  const min_x = Math.min(...nodes.map((node) => node.x));
  const min_y = Math.min(...nodes.map((node) => node.y));

  const offset = {
    x: -(max_x + min_x) / 2,
    y: -(max_y + min_y) / 2,
  };

  const factor = {
    x: (max_x - min_x) / 2 / 90,
    y: (max_y - min_y) / 2 / 45,
  };

  inputGraph = applyOffset(inputGraph, offset, factor);

  return inputGraph;
}

function applyOffset(
  graph: Graph<NodeInputData, LinkData>,
  offset: { x: number; y: number },
  factor: { x: number; y: number },
): Graph<NodeInputData, LinkData> {
  graph.forEachNode((node) => {
    const pos = node.data.pos
      .split(",")
      .map((coord: string) => parseFloat(coord))
      .slice(0, 2) as [number, number];
    node.data.pos = `${(pos[0] + offset.x) / factor.x},${(pos[1] + offset.y) / factor.y}`;
  });

  return graph;
}

function createKNNGraph(
  graphori: Graph<NodeInputData, LinkData>,
): Graph<NodeInputData, LinkData> {
  // Create a copy of the graph to avoid modifying the original
  const graph = createGraph();
  graphori.forEachNode((node) => {
    graph.addNode(node.id, node.data);
  });
  graphori.forEachLink((link) => {
    graph.addLink(link.fromId, link.toId, link.data);
  });

  const bestLinks: Link<LinkData>[] = [];
  const uniqueLinks = new Map();

  graph.forEachNode((node) => {
    const nodeLinks = node.links;
    if (nodeLinks != null) {
      nodeLinks.sort((a, b) => b.data.weight - a.data.weight);

      // Take top 2 links
      if (nodeLinks.length > 0) bestLinks.push(nodeLinks[0]);
      if (nodeLinks.length > 1) bestLinks.push(nodeLinks[1]);
      if (nodeLinks.length > 2) bestLinks.push(nodeLinks[2]);
    }
  });

  // Remove duplicates (bidirectional links)
  bestLinks.forEach((link) => {
    const key = `${link.fromId}-${link.toId}`;
    const reverseKey = `${link.toId}-${link.fromId}`;
    if (!uniqueLinks.has(key) && !uniqueLinks.has(reverseKey)) {
      uniqueLinks.set(key, link);
    }
  });

  // Clear graph and add only unique best links
  graph.clear();
  graphori.forEachNode((node) => {
    graph.addNode(node.id, node.data);
  });
  uniqueLinks.forEach((link) => {
    graph.addLink(link.fromId, link.toId, link.data);
  });

  return graph;
}

function computeSearchIndexes(
  subgraph: Graph<NodeData, LinkData>,
  gameDataMap: Map<string, GameRecord>,
) {
  const games: Game[] = [];

  // Extract games from all subgraphs
  subgraph.forEachNode((node) => {
    if (!node.data) return;

    const label = node.data.label || node.id.toString();
    const [x, y] = node.data.pos.split(",");

    games.push({
      Name: label,
      x,
      y,
      id: node.data.id.toString(),
      year: gameDataMap.get(node.data.id.toString())?.year || "Unknown",
    });
  });

  // Group games by first letter
  const groups: { [key: string]: Game[] } = {};
  games.forEach((game) => {
    const firstChar = game.Name.toString().charAt(0).toLowerCase();
    if (!groups[firstChar]) {
      groups[firstChar] = [];
    }
    groups[firstChar].push(game);
  });

  return Object.values(groups);
}

function writeVoronoi(subgraph: Graph<NodeData, LinkData>) {
  const nodes: { x: number; y: number; subgraph: number; id: string }[] = [];
  subgraph.forEachNode((node) => {
    const [x, y] = node.data.pos.split(",").map(Number);
    nodes.push({
      x,
      y,
      subgraph: parseInt(node.data.c),
      id: node.data.id.toString(),
    });
  });
  const points: [number, number][] = nodes.map((n) => [n.x, n.y]);

  // 🧠 Compute the convex hull
  const turfPoints = turf.featureCollection(
    points.map(([x, y]) => turf.point([x, y])),
  );
  const concave = turf.concave(turfPoints, {
    maxEdge: 2500,
    units: "kilometers",
  });

  if (!concave || concave.geometry.type !== "Polygon") {
    throw new Error("Concave hull could not be computed.");
  }

  // ✅ Add padding (e.g., 1 unit = ~1 km for Geo coordinates)
  const hull = turf.buffer(concave, 500, { units: "kilometers" });

  if (!hull || hull.geometry.type !== "Polygon") return;

  const bbox = turf.bbox(hull);
  const voronoi = d.Delaunay.from(points).voronoi(bbox);

  // 🧩 Clip Voronoi cells with convex hull
  const nodesBySubgraph = nodes.reduce(
    (acc, node, i) => {
      const polygon = voronoi.cellPolygon(i);
      const voronoiPolygon = turf.polygon([polygon.map(([x, y]) => [x, y])]);

      // 💥 Intersect with convex hull to clip
      const clipped = turf.intersect(
        turf.featureCollection([voronoiPolygon, hull]),
      );
      if (!clipped || clipped.geometry.type !== "Polygon") return acc;

      (acc[node.subgraph] ||= []).push({
        ...node,
        polygon: clipped.geometry.coordinates[0] as [number, number][],
      });
      return acc;
    },
    {} as { [key: number]: ((typeof nodes)[0] & { polygon: number[][] })[] },
  );
  // 🔄 Create union polygons for each subgraph
  const unionPolygons = Object.values(nodesBySubgraph).map((nodesArray) => {
    const polygons = nodesArray.map((node) => turf.polygon([node.polygon]));
    return turf.union(turf.featureCollection(polygons)) as Feature<
      Polygon,
      GeoJsonProperties
    >;
  });

  const intersections = unionPolygons.map((polygon, i) =>
    unionPolygons
      .map((_, j) => j)
      .filter(
        (j) => j !== i && turf.booleanIntersects(polygon, unionPolygons[j]),
      ),
  );

  const coloring = gen4col(intersections, true) as number[];
  const colorPalette = ["#516ebc", "#153477", "#00529c", "#37009c"];

  const features = unionPolygons.map((polygon, i) =>
    createGeoFeature(
      polygon?.geometry.coordinates[0] as [number, number][],
      colorPalette[coloring[i] % colorPalette.length],
      i,
    ),
  );

  return {
    type: "FeatureCollection",
    features,
  } as GeoJSON.GeoJSON;
}

function createGeoFeature(
  coordinates: [number, number][],
  color: string,
  index: number,
): GeoJSON.Feature<GeoJSON.Polygon, GeoJSON.GeoJsonProperties> {
  return {
    type: "Feature",
    id: index,
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
    properties: {
      fill: color,
    },
  };
}

function writeGeojson(subgraph: Graph<NodeData, LinkData>) {
  const features: GeoJSON.Feature[] = [];

  subgraph.forEachNode((node) => {
    const coordinates = node.data.pos.split(",").map(Number);

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates,
      },
      properties: {
        label: node.data.label,
        size: node.data.size,
        ratings: node.data.rating,
        complexity: node.data.complexity,
        min_players: node.data.min_players,
        max_players: node.data.max_players,
        min_players_rec: node.data.min_players_rec,
        max_players_rec: node.data.max_players_rec,
        min_players_best: node.data.min_players_best,
        max_players_best: node.data.max_players_best,
        min_time: node.data.min_time,
        max_time: node.data.max_time,
        bayes_rating: node.data.bayes_rating,
        id: node.data.id,
        year: node.data.year,
        c: node.data.c,
      },
    });
  });

  return {
    type: "FeatureCollection",
    features,
  } as GeoJSON.FeatureCollection;
}

function enrichGraphs(
  subgraph: Graph<NodeInputData, LinkData>,
  gameDataMap: Map<string, GameRecord>,
): Graph<NodeData, LinkData> {
  // Create enriched graph
  const enrichedGraph = createGraph<NodeData, LinkData>();

  subgraph.forEachNode((node) => {
    const gameData = gameDataMap.get(node.data.id.toString());
    if (!gameData) return;

    const votes = parseInt(gameData["num_votes"] || "0", 10);
    if (isNaN(votes)) {
      console.log(
        `Failed to parse num_votes: ${gameData["num_votes"]} for ID: ${node.data.id}`,
      );
    }

    enrichedGraph.addNode(node.data.id, {
      id: node.data.id,
      pos: node.data.pos,
      label: gameData["name"],
      rating: gameData["avg_rating"],
      complexity: gameData["complexity"],
      min_players: gameData["min_players"],
      max_players: gameData["max_players"],
      min_players_rec: gameData["min_players_rec"],
      max_players_rec: gameData["max_players_rec"],
      min_players_best: gameData["min_players_best"],
      max_players_best: gameData["max_players_best"],
      min_time: gameData["min_time"],
      max_time: gameData["max_time"],
      bayes_rating: gameData["bayes_rating"],
      year: gameData["year"],
      size: gameData["num_votes"],
      c:
        node.data.community == undefined
          ? undefined
          : node.data.community.toString(),
    });
  });

  subgraph.forEachLink((link) => {
    const fromNode = subgraph.getNode(link.fromId);
    const toNode = subgraph.getNode(link.toId);
    if (fromNode && toNode) {
      const fromGameData = gameDataMap.get(fromNode.data.id.toString());
      const toGameData = gameDataMap.get(toNode.data.id.toString());
      if (fromGameData && toGameData) {
        enrichedGraph.addLink(fromNode.data.id, toNode.data.id, link.data);
      }
    }
  });

  return enrichedGraph;
}

interface GameRecord {
  bgg_id: string;
  name: string;
  num_votes: string;
  avg_rating: string;
  complexity: string;
  min_players: string;
  max_players: string;
  min_players_rec: string;
  max_players_rec: string;
  min_players_best: string;
  max_players_best: string;
  min_time: string;
  max_time: string;
  category: string;
  mechanic: string;
  bayes_rating: string;
  year: string;
  label: string;
}

interface Game {
  Name: string;
  x: string;
  y: string;
  id: string;
  year: string;
}

interface NodeData extends NodeInputData {
  size: string;
  rating: string;
  complexity: string;
  min_players: string;
  max_players: string;
  min_players_rec: string;
  max_players_rec: string;
  min_players_best: string;
  max_players_best: string;
  min_time: string;
  max_time: string;
  bayes_rating: string;
  year: string;
  c: string;
}

interface LinkData {
  weight: number;
}

interface NodeInputData {
  id: number;
  label: string;
  community: number;
  pos: string;
}
