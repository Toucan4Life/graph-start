import express from "express";
import cors from "cors";
import fs from "fs";
import serveIndex from "serve-index";
import path from "path";
import fromDot from "ngraph.fromdot";
import createGraph, { Graph, Node } from "ngraph.graph";
import toDot from "ngraph.todot";
import * as d from "d3-delaunay";
import { parse } from "csv-parse/sync";

const app = express();
const port = 3010;

// Add headers before the routes are defined
app.use(cors());

import { fileURLToPath } from "url";
import { join } from "path";
import { execSync } from "child_process";

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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

function writeGraphs(subgraphs: Graph<NodeData, LinkData>[]) {
  let i = 0;
  subgraphs.forEach((subgraph) => {
    // subgraph.forEachLink(link => {
    //   link.data.fromId = subgraph.getNode(link.fromId).data.label
    //   link.data.toId = subgraph.getNode(link.toId).data.label
    // })
    try {
      fs.writeFileSync(
        join("data", "v1", "graphs", i + ".dot"),
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
      join("data", "v1", "names", gamelist[0].Name[0].toLowerCase() + ".json"),
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

function writeVoronoi(subgraphs: Graph<NodeData, LinkData>[]) {
  const mygeojson: {
    type: string;
    features: {
      type: string;
      id: number;
      geometry: { type: string; coordinates: [number, number][][] };
      properties: { fill: string };
    }[];
  } = { type: "FeatureCollection", features: [] };
  const chosenNodes: Node<NodeData>[] = [];
  subgraphs.forEach((subgraph) => {
    const nodes: Node<NodeData>[] = [];
    subgraph.forEachNode((node) => {
      nodes.push(node);
    });
    chosenNodes.push(
      nodes.reduce((seed, item) => {
        return seed && seed.data.weight > item.data.weight ? seed : item;
      })
    );
  });

  const newLocal: [number, number][] = chosenNodes.map(
    (node) =>
      node.data.l
        .split(",")
        .map((coord: string) => parseFloat(coord))
        .slice(0, 2) as [number, number]
  );
  //console.log(JSON.stringify(newLocal))

  const delaunay = d.Delaunay.from(newLocal);
  const voronoi = delaunay.voronoi([-45, -45, 45, 45]);
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

  mygeojson.features = test;
  try {
    fs.writeFileSync("./data/v1/borders.geojson", JSON.stringify(mygeojson));
  } catch (e) {
    console.log(e);
  }
}

function writeGeojson() {
  const directoryPath = "./data/v1/graphs";
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
          .slice(0, -1)
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
      "./data/v1/geojson/points.geojson",
      JSON.stringify(mygeojson)
    );
  } catch (e) {
    console.log(e);
  }
  execSync(
    "tippecanoe --no-tile-compression -zg --drop-densest-as-needed --extend-zooms-if-still-dropping --output-to-directory data/v1/points data/v1/geojson/points.geojson --force"
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
      node.data.id = node.id.toString();
      const nodeData = map.get(node.id.toString());
      if (nodeData) {
        newgraph.addNode(nodeData["name"], node.data);
      }
    });

    subgraph.forEachLink((link) => {
      const fromNode = map.get(link.fromId.toString());
      const toNode = map.get(link.toId.toString());
      if (fromNode && toNode) {
        newgraph.addLink(fromNode["name"], toNode["name"], link.data);
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
