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

app.get("/render", (_req, res) => {
  fs.readdirSync("./data/v2/geojson").forEach((file) => {
    fs.unlinkSync(path.join("./data/v2/geojson", file));
  });
  fs.readdirSync("./data/v2/graphs").forEach((file) => {
    fs.unlinkSync(path.join("./data/v2/graphs", file));
  });
  fs.readdirSync("./data/v2/names").forEach((file) => {
    fs.unlinkSync(path.join("./data/v2/names", file));
  });
  fs.readdirSync("./data/v2/points").forEach((file) => {
    const curPath = path.join("./data/v2/points", file);
    if (fs.lstatSync(curPath).isDirectory()) {
      fs.rmSync(curPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(curPath);
    }
  });

  const graphToInclude = 27;
  // Exclude the clustered_graph.dot file
  const numberOfGraphs: number =
    fs.readdirSync("./graph").filter((file) => file.endsWith(".dot")).length -
    1;

  const inputSubgraphs = [];
  for (let i = numberOfGraphs - graphToInclude; i <= numberOfGraphs - 1; i++) {
    const graph: Graph<NodeInputData, LinkData> = fromDot(
      fs.readFileSync("./graph/subgraph_" + i + ".dot").toString()
    );
    inputSubgraphs.push(graph);
  }

  const clusterGraph: Graph<NodeInputData, LinkData> = fromDot(
    fs.readFileSync("./graph/clustered_graph.dot").toString()
  );
  for (let i = 0; i < numberOfGraphs - graphToInclude; i++) {
    clusterGraph.removeNode(i);
  }
  const subgraphs = createSubgraphCluster(inputSubgraphs, clusterGraph);

  const input = fs.readFileSync("./bgg_GameItem.csv", "utf8");
  const records: GameRecord[] = parse(input, {
    columns: true,
    skip_empty_lines: true,
  });

  const gameDataMap = new Map(
    records.map((record) => [record["bgg_id"], record])
  );

  const enrichedSubgraphs = enrichGraphs(subgraphs, gameDataMap);
  enrichedSubgraphs.forEach((subgraph, i) => {
    fs.writeFileSync(join("data", "v2", "graphs", `${i}.dot`), toDot(subgraph));
  });

  const arrays = computeSearchIndexes(enrichedSubgraphs);
  arrays.forEach((gamelist) => {
    fs.writeFileSync(
      join(
        "data",
        "v2",
        "names",
        gamelist[0].Name.toString()[0].toLowerCase() + ".json"
      ),
      JSON.stringify(
        gamelist.map((element) => [
          element.Name,
          parseFloat(element.x),
          parseFloat(element.y),
          element.id,
        ])
      )
    );
  });

  const points = writeGeojson(enrichedSubgraphs);
  fs.writeFileSync("./data/v2/geojson/points.geojson", JSON.stringify(points));

  execSync(
    "tippecanoe --no-tile-compression -zg --drop-densest-as-needed --extend-zooms-if-still-dropping --output-to-directory data/v2/points data/v2/geojson/points.geojson --force"
  );

  const borders = writeVoronoi(enrichedSubgraphs);
  fs.writeFileSync("./data/v2/borders.geojson", JSON.stringify(borders));

  res.send("Done Rendering");
});

function createSubgraphCluster(
  inputSubgraphs: Graph<NodeInputData, LinkData>[],
  inputClusterGraph: Graph<NodeInputData, LinkData>
): Graph<NodeInputData, LinkData>[] {
  const layouts = inputSubgraphs.map((graph) => calculateLayout(graph));
  const subgraphsboxs = layouts.map((layout) => {
    const GraphRect = layout.getGraphRect();
    return (
      Math.sqrt(
        Math.pow(Math.abs(GraphRect.max_x - GraphRect.min_x), 2) +
          Math.pow(Math.abs(GraphRect.max_y - GraphRect.min_y), 2)
      ) / 2
    );
  });

  let subgraphs = layouts.map((layout) => {
    layout.graph.forEachNode((node) => {
      const pos = layout.getNodePosition(node.id);
      node.data.l = `${pos.x},${pos.y}`;
    });
    return layout.graph;
  });

  const clusterLayout = calculateClusteredLayout(
    inputClusterGraph,
    subgraphsboxs
  );

  subgraphs = subgraphs.map((subgraph, i) =>
    applyOffset(subgraph, clusterLayout[i], { x: 1, y: 1 })
  );

  const nodes = subgraphs.flatMap((subgraph) => {
    const array: { x: number; y: number }[] = [];
    subgraph.forEachNode((node) => {
      const [x, y] = node.data.l.split(",").map(parseFloat);
      array.push({ x, y });
    });
    return array;
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

  subgraphs = subgraphs.map((subgraph) => {
    return applyOffset(subgraph, offset, factor);
  });

  return subgraphs;
}

function applyOffset(
  graph: Graph<NodeInputData, LinkData>,
  offset: { x: number; y: number },
  factor: { x: number; y: number }
): Graph<NodeInputData, LinkData> {
  graph.forEachNode((node) => {
    const pos = node.data.l
      .split(",")
      .map((coord: string) => parseFloat(coord))
      .slice(0, 2) as [number, number];
    node.data.l = `${(pos[0] + offset.x) / factor.x},${(pos[1] + offset.y) / factor.y}`;
  });

  return graph;
}

function createKNNGraph(
  graphori: Graph<NodeInputData, LinkData>
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

function calculateClusteredLayout(
  inputClusterGraph: Graph<NodeInputData, LinkData>,
  nodeRadius: number[]
): { x: number; y: number }[] {
  inputClusterGraph = createKNNGraph(inputClusterGraph);
  const layout = calculateLayout(inputClusterGraph);
  // Create D3 nodes with radius information
  const nodes: Node<{ id: string }>[] = [];
  inputClusterGraph.forEachNode((node) => {
    nodes.push(node);
  });
  const d3Nodes = nodes.map((node, i) => ({
    id: node.data.id,
    index: i,
    radius: nodeRadius[i],
    x: layout.getNodePosition(node.id).x,
    y: layout.getNodePosition(node.id).y,
  }));

  // Create force simulation
  const simulation = d3.forceSimulation(d3Nodes).force(
    "collision",
    d3
      .forceCollide()
      .radius((d) => d.radius + 2) // Add small padding
      .strength(0.9)
      .iterations(50)
  );
  // Run simulation for a fixed number of iterations
  const numIterations = 3000;
  for (let i = 0; i < numIterations; i++) {
    simulation.tick();
  }

  return d3Nodes.map((node) => ({ x: node.x, y: node.y }));
}

function calculateLayout(
  graph: Graph<NodeInputData, LinkData>
): Layout<Graph<NodeInputData, LinkData>> {
  const layout = createLayout(graph, {
    timeStep: 1,
    springLength: 55,
    springCoefficient: 0.08,
    gravity: -10,
    dragCoefficient: 0.09,
  });

  graph.forEachLink((link) => {
    const spring = layout.getSpring(link.fromId, link.toId);
    if (!spring) return;
    spring.coefficient = link.data.weight;
  });

  for (let i = 0; i < 10000 && !layout.step(); i++) {
    if (i % 1000 === 0) {
      console.log(`Step: ${i}`);
    }
  }

  return layout;
}

function computeSearchIndexes(subgraphs: Graph<NodeData, LinkData>[]) {
  const games: Game[] = [];

  // Extract games from all subgraphs
  subgraphs.forEach((subgraph) => {
    subgraph.forEachNode((node) => {
      if (!node.data) return;

      const label = node.data.label || node.id.toString();
      const [x, y] = node.data.l.split(",");

      games.push({
        Name: label,
        x,
        y,
        id: node.data.id,
      });
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

function writeVoronoi(subgraphs: Graph<NodeData, LinkData>[]) {
  const nodes: { x: number; y: number; subgraph: number; id: string }[] = [];
  subgraphs.forEach((subgraph, index) => {
    subgraph.forEachNode((node) => {
      const [x, y] = node.data.l.split(",").map(Number);
      nodes.push({ x, y, subgraph: index, id: node.data.id });
    });
  });

  const points: [number, number][] = nodes.map((n) => [n.x, n.y]);

  // 🧠 Compute the convex hull
  const turfPoints = turf.featureCollection(
    points.map(([x, y]) => turf.point([x, y]))
  );
  const concave = turf.concave(turfPoints);

  if (!concave || concave.geometry.type !== "Polygon") {
    throw new Error("Concave hull could not be computed.");
  }

  // ✅ Add padding (e.g., 1 unit = ~1 km for Geo coordinates)
  const hull = turf.buffer(concave, 500, { units: "kilometers" });

  if(!hull || hull.geometry.type !== "Polygon") return

  const bbox = turf.bbox(hull);
  const voronoi = d.Delaunay.from(points).voronoi(bbox);

  // 🧩 Clip Voronoi cells with convex hull
  const nodesBySubgraph = nodes.reduce(
    (acc, node, i) => {
      const polygon = voronoi.cellPolygon(i);
      const voronoiPolygon = turf.polygon([polygon.map(([x, y]) => [x, y])]);

      // 💥 Intersect with convex hull to clip
      const clipped = turf.intersect(
        turf.featureCollection([voronoiPolygon, hull])
      );
      if (!clipped || clipped.geometry.type !== "Polygon") return acc;

      (acc[node.subgraph] ||= []).push({
        ...node,
        polygon: clipped.geometry.coordinates[0] as [number, number][],
      });
      return acc;
    },
    {} as { [key: number]: ((typeof nodes)[0] & { polygon: number[][] })[] }
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
        (j) => j !== i && turf.booleanIntersects(polygon, unionPolygons[j])
      )
  );

  const coloring = gen4col(intersections, true) as number[];
  const colorPalette = ["#516ebc", "#153477", "#00529c", "#37009c"];

  const features = unionPolygons.map((polygon, i) =>
    createGeoFeature(
      polygon?.geometry.coordinates[0] as [number, number][],
      colorPalette[coloring[i] % colorPalette.length],
      i
    )
  );

  return {
    type: "FeatureCollection",
    features,
  } as GeoJSON.GeoJSON;
}

function createGeoFeature(
  coordinates: [number, number][],
  color: string,
  index: number
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

function writeGeojson(subgraphs: Graph<NodeData, LinkData>[]) {
  const features: GeoJSON.Feature[] = [];

  subgraphs.forEach((subgraph, subgraphIndex) => {
    subgraph.forEachNode((node) => {
      const coordinates = node.data.l.split(",").map(Number);

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
          parent: subgraphIndex,
          year: node.data.year,
        },
      });
    });
  });

  return {
    type: "FeatureCollection",
    features,
  } as GeoJSON.FeatureCollection;
}

function enrichGraphs(
  subgraphs: Graph<NodeInputData, LinkData>[],
  gameDataMap: Map<string, GameRecord>
): Graph<NodeData, LinkData>[] {
  return subgraphs.map((subgraph) => {
    // Calculate total votes for size normalization
    let totalVotes = 0;
    subgraph.forEachNode((node) => {
      const gameData = gameDataMap.get(node.data.id.toString());
      const votes = parseInt(gameData?.["num_votes"] || "0", 10);
      totalVotes += isNaN(votes) ? 0 : votes;
    });

    // Create enriched graph
    const enrichedGraph = createGraph<NodeData, LinkData>();

    subgraph.forEachNode((node) => {
      const gameData = gameDataMap.get(node.data.id.toString());
      if (!gameData) return;

      const votes = parseInt(gameData["num_votes"] || "0", 10);
      if (isNaN(votes)) {
        console.log(
          `Failed to parse num_votes: ${gameData["num_votes"]} for ID: ${node.data.id}`
        );
      }

      enrichedGraph.addNode(gameData["name"], {
        id: node.data.id,
        l: node.data.l,
        label: node.data.label,
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
        size: ((votes || 0) / totalVotes).toString(),
      });
    });

    subgraph.forEachLink((link) => {
      const fromNode = subgraph.getNode(link.fromId);
      const toNode = subgraph.getNode(link.toId);
      if (fromNode && toNode) {
        const fromGameData = gameDataMap.get(fromNode.data.id.toString());
        const toGameData = gameDataMap.get(toNode.data.id.toString());
        if (fromGameData && toGameData) {
          enrichedGraph.addLink(
            fromGameData["name"],
            toGameData["name"],
            link.data
          );
        }
      }
    });

    return enrichedGraph;
  });
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
}

interface Game {
  Name: string;
  x: string;
  y: string;
  id: string;
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
}

interface LinkData {
  weight: number;
}

interface NodeInputData {
  id: string;
  l: string;
  label: string;
}
