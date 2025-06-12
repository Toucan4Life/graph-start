import express from "express";
import cors from "cors";
import fs from "fs";
import serveIndex from "serve-index";
import path from "path";
import fromDot from "ngraph.fromdot";
import createGraph, { Graph, Node, NodeId } from "ngraph.graph";
import toDot from "ngraph.todot";
import * as d from "d3-delaunay";
import createLayout, { Layout } from "ngraph.forcelayout";
import { parse } from "csv-parse/sync";
import * as d3 from "d3";
import * as turf from "@turf/turf";

const app = express();
const port = 3010;

// Add headers before the routes are defined
app.use(cors());

import { fileURLToPath } from "url";
import { join } from "path";
import { execSync } from "child_process";
import { Console } from "console";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const htmlPath = path.join(__dirname, "data");
app.use("/data", serveIndex(htmlPath));
app.use("/data", express.static(htmlPath));

app.get("/", (_req, res) => {
  res.send("Hello World!");
});

app.post("/ship", (r, s) => {
  let body = "";
  r.on("readable", function () {
    body += r.read();
  });
  r.on("end", function () {
    console.log("starting");
    const subgraphsjson = JSON.parse(body.slice(0, -4));
    let subgraphs: Graph<NodeData, LinkData>[] = subgraphsjson.map(
      (subgraphjson: string) => fromDot(subgraphjson)
    );
    subgraphs = changeIdToLabel(subgraphs);
    subgraphs = enrichGraphs(subgraphs);
    writeGraphs(subgraphs);
    writeNames(subgraphs, groupByName);
    writeGeojson();
    writeVoronoi(subgraphs);
    console.log("done");
    s.write("OK");
    s.end();
  });
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

  let subgraphs: Graph<NodeData, LinkData>[] = [];
  const graphFiles =
    fs.readdirSync("./graph").filter((file) => file.endsWith(".dot")).length -
    1; // Exclude the clustered_graph.dot file
  const subgraphsboxs: [number] = new Array(graphFiles).fill(0);
  const graphToInclude = 7;
  for (let i = graphFiles - graphToInclude; i < graphFiles; i++) {
    const graph: Graph<
      { label: string; id: string; l: string },
      { weight: number }
    > = fromDot(fs.readFileSync("./graph/subgraph_" + i + ".dot").toString());

    const graphAndLayout = calculateLayout(graph);
    const GraphRect = graphAndLayout[1].getGraphRect();
    subgraphsboxs[i] =
      Math.sqrt(
        Math.pow(Math.abs(GraphRect.max_x - GraphRect.min_x), 2) +
          Math.pow(Math.abs(GraphRect.max_y - GraphRect.min_y), 2)
      ) / 2;
    subgraphs.push(graphAndLayout[0]);
  }

  const clusterGraph: Graph<
    { label: string; id: string; l: string },
    { weight: number }
  > = fromDot(fs.readFileSync("./graph/clustered_graph.dot").toString());
  for (let i = 0; i < graphFiles - graphToInclude; i++) {
    // const links = clusterGraph.getLinks(i);
    // if (links === null) {
    //   console.warn(`No links found for node ${i}`);
    //   continue;
    // }
    // links.forEach((link) => {
    //   clusterGraph.removeLink(link);
    // });
    clusterGraph.removeNode(i);
  }
  const clusterLayout = calculateClusteredLayout(clusterGraph, subgraphsboxs);

  for (let i = 0; i < graphToInclude; i++) {
    const offset = clusterLayout[i + graphFiles - graphToInclude];
    const g = subgraphs[i];
    let newG = applyOffset(g, offset, {
      x: 1,
      y: 1,
    });
    subgraphs[i] = newG;
  }

  const nodes = subgraphs.flatMap((subgraph) => {
    const array: { x: number; y: number }[] = [];
    subgraph.forEachNode((node) => {
      const coords = node.data.l
        .split(",")
        .map((coord: string) => parseFloat(coord))
        .slice(0, 2) as [number, number];
      array.push({ x: coords[0], y: coords[1] });
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

  for (let i = 0; i < graphToInclude; i++) {
    const g = subgraphs[i];
    let newG = applyOffset(g, offset, factor);
    subgraphs[i] = newG;
  }

  subgraphs = changeIdToLabel(subgraphs);
  subgraphs = enrichGraphs(subgraphs);
  writeGraphs(subgraphs);
  writeNames(subgraphs, groupByName);
  writeGeojson();

  const voronoiPoints: {
    x: number;
    y: number;
  }[] = clusterLayout.slice(-graphToInclude).map((pos) => {
    pos.x = (pos.x + offset.x) / factor.x;
    pos.y = (pos.y + offset.y) / factor.y;
    return pos;
  });
  //writeVoronoi(voronoiPoints);
  writeVoronoi2(subgraphs);
  // const dottedgraph = toDot(graph);
  // fs.writeFileSync("./graph_layout/subgraph_1.dot", dottedgraph, { flag: "w" });
  res.send("Done Rendering");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

function applyOffset(
  graph: Graph<{ label: string; id: number; l: string }, { weight: number }>,
  offset: { x: number; y: number },
  factor: { x: number; y: number }
): Graph<{ label: string; id: number; l: string }, { weight: number }> {
  graph.forEachNode((node) => {
    const pos = node.data.l
      .split(",")
      .map((coord: string) => parseFloat(coord))
      .slice(0, 2) as [number, number];
    node.data.l = `${(pos[0] + offset.x) / factor.x},${(pos[1] + offset.y) / factor.y}`;
  });

  return graph;
}

function calculateClusteredLayout(
  graph: Graph<{ label: string; id: string; l: string }, { weight: number }>,
  subgraphsboxs: [number]
): { x: number; y: number }[] {
  // const nodes: (d3.SimulationNodeDatum & { id: number })[] = [];
  // graph.forEachNode((node) => {
  //   nodes.push({
  //     id: parseInt(node.id.toString()),
  //   });
  // });

  // // Extract links from ngraph
  // const links: d3.SimulationLinkDatum<d3.SimulationNodeDatum>[] = [];
  // graph.forEachLink((link) => {
  //   links.push({
  //     source: link.fromId,
  //     target: link.toId,
  //     weight: link.data.weight,
  //   });
  // });

  // // Create D3 force simulation
  // const simulation = d3
  //   .forceSimulation<
  //     d3.SimulationNodeDatum & { id: number },
  //     d3.SimulationLinkDatum<d3.SimulationNodeDatum & { id: number }>
  //   >(nodes)
  //   .force(
  //     "link",
  //     d3
  //       .forceLink(links)
  //       .id((d) => d.id)
  //       // .strength((d) => d.weight)
  //       .distance(100)
  //   )
  //   .force("charge", d3.forceManyBody().strength(-300))
  //   .force("center", d3.forceCenter())
  //   .force(
  //     "collision",
  //     d3.forceCollide().radius((d) => subgraphsboxs[d.index as number] + 2)
  //   ); // Add padding between nodes

  // console.log("Starting simulation for clustered layout");
  // simulation.stop();
  // for (let i = 0; i < 100; ++i) simulation.tick();
  // console.log("Ending simulation for clustered layout");

  const layout = createLayout(graph, {
    timeStep: 1,
    springLength: 10,
    springCoefficient: 0.8,
    gravity: -12,
    dragCoefficient: 0.9,
  });
  graph.forEachLink((link) => {
    const spring = layout.getSpring(link.fromId, link.toId);
    const fromR = subgraphsboxs[link.fromId as number];
    const toR = subgraphsboxs[link.toId as number];
    if (!spring) {
      console.warn("spring not found");
      return;
    }
    spring.length = 550 + fromR + toR;
  });
  for (let i = 0; i < 10000 && !layout.step(); i++) {
    if (i % 1000 === 0) {
      console.log(`Step: ${i}`);
    }
  }

  const array: { x: number; y: number }[] = new Array(
    subgraphsboxs.length
  ).fill({ x: 0, y: 0 });
  graph.forEachNode((node) => {
    array[parseInt(node.id.toString())] = layout.getNodePosition(node.id);
  });

  // nodes.forEach((node) => {
  //   array[parseInt(node.id.toString())] = { x: node.x, y: node.y };
  // });

  return array;
}

function calculateLayout(
  graph: Graph<{ label: string; id: string; l: string }, { weight: number }>
): [
  Graph<{ label: string; id: string; l: string }, { weight: number }>,
  Layout<Graph<{ label: string; id: string; l: string }, { weight: number }>>,
] {
  const layout = createLayout(graph, {
    timeStep: 1,
    springLength: 10,
    springCoefficient: 0.8,
    gravity: -12,
    dragCoefficient: 0.9,
  });

  for (let i = 0; i < 10000 && !layout.step(); i++) {
    if (i % 1000 === 0) {
      console.log(`Step: ${i}`);
    }
  }

  graph.forEachNode((node) => {
    const pos = layout.getNodePosition(node.id);
    node.data.l = `${pos.x},${pos.y}`;
  });
  return [graph, layout];
}

function writeGraphs(subgraphs: Graph<NodeData, LinkData>[]) {
  let i = 0;
  subgraphs.forEach((subgraph) => {
    // subgraph.forEachLink(link => {
    //   link.data.fromId = subgraph.getNode(link.fromId).data.label
    //   link.data.toId = subgraph.getNode(link.toId).data.label
    // })
    try {
      fs.writeFileSync(
        join("data", "v2", "graphs", i + ".dot"),
        toDot(subgraph)
      );
      // file written successfully
      i = i + 1;
    } catch (err) {
      console.error(err);
    }
  });
}

function writeNames(
  subgraphs: Graph<NodeData, LinkData>[],
  groupByName: { (strings: Game[]): Game[][] }
) {
  const namesArray: Game[] = [];
  subgraphs.forEach(function (subgraph) {
    subgraph.forEachNode((node) => {
      if (node.data !== undefined) {
        if (node.data.label === undefined) {
          node.data.label = node.id.toString();
        }
        const newLocal = node.data.l.split(",");
        namesArray.push({
          Name: node.data.label.toString(),
          x: newLocal[0],
          y: newLocal[1],
          id: node.data.id,
        });
      }
    });
  });
  const arrays = groupByName(namesArray);
  arrays.forEach((gamelist) => {
    fs.writeFileSync(
      join("data", "v2", "names", gamelist[0].Name[0].toLowerCase() + ".json"),
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
}
function writeVoronoi2(subgraphs: Graph<NodeData, LinkData>[]) {
  const nodes: {
    x: number;
    y: number;
    subgraph: number;
    id: string;
    polygon: d.Delaunay.Polygon;
    neighbor: number[];
  }[] = [];
  subgraphs.forEach((subgraph, index) => {
    subgraph.forEachNode((node) => {
      const newLocal = node.data.l
        .split(",")
        .map((coord: string) => parseFloat(coord));
      nodes.push({
        x: newLocal[0],
        y: newLocal[1],
        subgraph: index,
        id: node.data.id,
        polygon: [],
        neighbor: [],
      });
    });
  });

  const newLocal: [number, number][] = nodes.map((p) => [p.x, p.y]);
  //console.log(JSON.stringify(newLocal))

  const delaunay = d.Delaunay.from(newLocal);
  const voronoi = delaunay.voronoi([-90, -45, 90, 45]);
  const neigborColor: [number, string][] = [];
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].polygon = voronoi.cellPolygon(i);
    nodes[i].neighbor = [...voronoi.neighbors(i)];
  }

  const nodesBySubgraph: { [key: number]: typeof nodes } = {};
  nodes.forEach((node) => {
    if (!nodesBySubgraph[node.subgraph]) {
      nodesBySubgraph[node.subgraph] = [];
    }
    nodesBySubgraph[node.subgraph].push(node);
  });

  // Iterate over nodesBySubgraph and log the subgraph index and number of nodes
  const test2 = Object.entries(nodesBySubgraph).map(
    ([subgraphIndex, nodesArray]) => {
      const points = nodesArray.map((node) => {
        const points = node.polygon.map((point) => [point[0], point[1]]);
        return turf.polygon([points]);
      });
      return turf.union(turf.featureCollection(points));
    }
  );

  let test4 = test2.map((t,i) => {
    const neighbor : number[]= test2.map((n,j) => [n,j]).filter(n => turf.booleanIntersects(t,n[0])).map((n) => n[1]);
    const excludedColors = neigborColor
      .filter((t) => neighbor.includes(t[0]))
      .map((t) => t[1]);
    const color = getRandomColor(excludedColors);
    neigborColor.push([i, color]);
    return computeGeoFeature(
      t?.geometry.coordinates[0],
      color,
      i
    );
  });
  // const test = [...voronoi.cellPolygons()].map(function (point) {
  //   const neighbor = [...voronoi.neighbors(point.index)];
  //   const excludedColors = neigborColor
  //     .filter((t) => neighbor.includes(t[0]))
  //     .map((t) => t[1]);
  //   const color = getRandomColor(excludedColors);
  //   neigborColor.push([point.index, color]);
  //   return computeGeoFeature(point, color);
  // });

  const mygeojson: {
    type: string;
    features: {
      type: string;
      id: number;
      geometry: { type: string; coordinates: [number, number][][] };
      properties: { fill: string };
    }[];
  } = { type: "FeatureCollection", features: [] };
  mygeojson.features = test4;
  try {
    fs.writeFileSync("./data/v2/borders.geojson", JSON.stringify(mygeojson));
  } catch (e) {
    console.log(e);
  }

  function computeGeoFeature(
    point: d.Delaunay.Polygon & { index: number },
    color: string,
    index: number
  ): {
    type: string;
    id: number;
    geometry: { type: string; coordinates: [number, number][][] };
    properties: { fill: string };
  } {
    return {
      type: "Feature",
      id: index,
      geometry: {
        type: "Polygon",
        coordinates: [point as [number, number][]],
      },
      properties: {
        fill: color,
      },
    };
  }
}

function writeVoronoi(points: { x: number; y: number }[]) {
  const newLocal: [number, number][] = points.map((p) => [p.x, p.y]);
  //console.log(JSON.stringify(newLocal))

  const delaunay = d.Delaunay.from(newLocal);
  const voronoi = delaunay.voronoi([-90, -45, 90, 45]);
  const neigborColor: [number, string][] = [];
  const test = [...voronoi.cellPolygons()].map(function (point) {
    const neighbor = [...voronoi.neighbors(point.index)];
    const excludedColors = neigborColor
      .filter((t) => neighbor.includes(t[0]))
      .map((t) => t[1]);
    const color = getRandomColor(excludedColors);
    neigborColor.push([point.index, color]);
    return {
      type: "Feature",
      id: newLocal
        .map((node) => voronoi.contains(point.index, node[0], node[1]))
        .findIndex((element) => element),
      geometry: {
        type: "Polygon",
        coordinates: [point as [number, number][]],
      },
      properties: {
        fill: color,
      },
    };
  });

  const mygeojson: {
    type: string;
    features: {
      type: string;
      id: number;
      geometry: { type: string; coordinates: [number, number][][] };
      properties: { fill: string };
    }[];
  } = { type: "FeatureCollection", features: [] };
  mygeojson.features = test;
  try {
    fs.writeFileSync("./data/v2/borders.geojson", JSON.stringify(mygeojson));
  } catch (e) {
    console.log(e);
  }
}

function writeGeojson() {
  const directoryPath = "./data/v2/graphs";
  const pointsDot: [number, Node<NodeData>][] = [];
  const filenames = fs.readdirSync(directoryPath);
  filenames.forEach((file) => {
    const filePath = path.join(directoryPath, file);

    const t: Graph<NodeData, LinkData> = fromDot(
      fs.readFileSync(filePath).toString()
    );
    t.forEachNode((node) => {
      pointsDot.push([parseInt(file.slice(0, -4)), node]);
    });
  });

  const mygeojson: {
    type: string;
    features: {
      type: string;
      geometry: { type: string; coordinates: number[] };
      properties: {
        label: string;
        size: string;
        ratings: string;
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
        id: string;
        parent: number;
      };
    }[];
  } = { type: "FeatureCollection", features: [] };
  for (const point of pointsDot) {
    const feature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: point[1].data.l
          .split(",")
          .map((str: string) => parseFloat(str)),
      },
      properties: {
        label: point[1].data.label,
        size: point[1].data.size,
        ratings: point[1].data.rating,
        complexity: point[1].data.complexity,
        min_players: point[1].data.min_players,
        max_players: point[1].data.max_players,
        min_players_rec: point[1].data.min_players_rec,
        max_players_rec: point[1].data.max_players_rec,
        min_players_best: point[1].data.min_players_best,
        max_players_best: point[1].data.max_players_best,
        min_time: point[1].data.min_time,
        max_time: point[1].data.max_time,
        category: point[1].data.category,
        mechanic: point[1].data.mechanic,
        bayes_rating: point[1].data.bayes_rating,
        id: point[1].data.id,
        parent: point[0],
      },
    };

    mygeojson.features.push(feature);
  }
  try {
    fs.writeFileSync(
      "./data/v2/geojson/points.geojson",
      JSON.stringify(mygeojson)
    );
  } catch (e) {
    console.log(e);
  }
  execSync(
    "tippecanoe --no-tile-compression -zg --drop-densest-as-needed --extend-zooms-if-still-dropping --output-to-directory data/v2/points data/v2/geojson/points.geojson --force"
  );
}

function groupByName(strings: Game[]): Game[][] {
  // Create an object to hold the groups
  const groups: { [key: string]: Game[] } = {};

  // Iterate through the sorted list of strings
  strings.forEach((string) => {
    // Get the first character of the current string
    //console.log(string)
    let firstChar = "";

    try {
      if (string.Name === undefined) {
        console.error("Name not found :" + JSON.stringify(string));
      }
      firstChar = string.Name.charAt(0).toLowerCase();
    } catch (error) {
      console.error("Name not found :" + JSON.stringify(string));
      console.error("Error: ", error);
    }

    // If the group for this character doesn't exist, create it
    if (!groups[firstChar]) {
      groups[firstChar] = [];
    }

    // Add the current string to the appropriate group
    groups[firstChar].push(string);
  });

  // Convert the grouped object into a list of lists
  const result = Object.values(groups);

  return result;
}
function getRandomColor(excludedColors: string[]): string {
  const colors: string[] = ["#516ebc", "#153477", "#00529c", "#37009c"].filter(
    (x) => !excludedColors.includes(x)
  );

  return colors[Math.floor(Math.random() * colors.length)];
}

function enrichGraphs(
  subgraphs: Graph<NodeData, LinkData>[]
): Graph<NodeData, LinkData>[] {
  const input = fs.readFileSync("./bgg_GameItem.csv", "utf8");

  const records: GameRecord[] = parse(input, {
    columns: true,
    skip_empty_lines: true,
  });
  const map = new Map(records.map((key) => [key["bgg_id"], key]));

  subgraphs.forEach((subgraph) =>
    subgraph.forEachNode((node) => {
      const row = map.get(node.data.id.toString());
      if (!row) return;
      node.data.size = row["num_votes"];
      node.data.rating = row["avg_rating"];
      node.data.complexity = row["complexity"];
      node.data.min_players = row["min_players"];
      node.data.max_players = row["max_players"];
      node.data.min_players_rec = row["min_players_rec"];
      node.data.max_players_rec = row["max_players_rec"];
      node.data.min_players_best = row["min_players_best"];
      node.data.max_players_best = row["max_players_best"];
      node.data.min_time = row["min_time"];
      node.data.max_time = row["max_time"];
      node.data.category = row["category"];
      node.data.mechanic = row["mechanic"];
      node.data.bayes_rating = row["bayes_rating"];
    })
  );

  return subgraphs;
}

function changeIdToLabel(
  subgraphs: Graph<NodeData, LinkData>[]
): Graph<NodeData, LinkData>[] {
  const input = fs.readFileSync("./bgg_GameItem.csv", "utf8");

  const records: GameRecord[] = parse(input, {
    columns: true,
    skip_empty_lines: true,
  });
  const map = new Map(records.map((key) => [key["bgg_id"], key]));

  return subgraphs.map((subgraph) => {
    const newgraph = createGraph();
    subgraph.forEachNode((node) => {
      // node.data.id = node.id.toString();
      const nodeData = map.get(node.data.id.toString());
      if (nodeData) {
        newgraph.addNode(nodeData["name"], node.data);
      }
    });

    subgraph.forEachLink((link) => {
      const fromNodeObj = subgraph.getNode(link.fromId);
      const toNodeObj = subgraph.getNode(link.toId);
      if (fromNodeObj && toNodeObj) {
        const fromNode = map.get(fromNodeObj.data.id.toString());
        const toNode = map.get(toNodeObj.data.id.toString());
        if (fromNode && toNode) {
          newgraph.addLink(fromNode["name"], toNode["name"], link.data);
        }
      }
    });

    return newgraph;
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
}
interface Game {
  Name: string;
  x: string;
  y: string;
  id: string;
}
interface NodeData {
  weight: number;
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
  category: string;
  mechanic: string;
  bayes_rating: string;
  id: string;
  l: string;
  label: string;
}
interface LinkData {
  weight: number;
}
