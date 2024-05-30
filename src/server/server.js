
import express from 'express'
import cors from 'cors';
import fs from "fs";
import serveIndex from "serve-index";
import path from "path"
import fromDot from 'ngraph.fromdot';
import toDot from 'ngraph.todot';
import * as d3 from 'd3-geo-voronoi'

const app = express()
const port = 3010

// Add headers before the routes are defined
app.use(cors());

import { fileURLToPath } from 'url';
import { join } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

var htmlPath = path.join(__dirname, 'data');
app.use('/data', serveIndex(htmlPath));
app.use('/data', express.static(htmlPath));

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.post("/ship", (r, s) => {
  var body = "";
  r.on('readable', function () {
    body += r.read();
  });
  r.on('end', function () {
    var subgraphsjson = JSON.parse(body.slice(0, -4));
    var subgraphs = subgraphsjson.map(subgraphjson => fromDot(subgraphjson))
    writeGraphs(subgraphs);
    writeNames(subgraphs, groupByName);
    writeGeojson();
    writeVoronoi(subgraphs);
    s.write("OK");
    s.end();
  });
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

function writeGraphs(subgraphs) {
  var i = 0;
  subgraphs.forEach(subgraph => {
    try {
      fs.writeFileSync(join("data", "v1", "graphs", i + '.dot'), toDot(subgraph));
      // file written successfully
      i = i + 1;
    } catch (err) {
      console.error(err);
    }
  });
}

function writeNames(subgraphs, groupByName) {
  var namesArray = [];
  subgraphs.forEach(function (subgraph) {
    subgraph.forEachNode(node => {
      if (node.data !== undefined) {
        if (node.data.label === undefined) {
          node.data.label = node.id.toString();
        }
        var newLocal = node.data.l;
        namesArray.push({ 'Name': node.data.label, 'x': newLocal[0], 'y': newLocal[1] });
      }
    });
  });
  var arrays = groupByName(namesArray);
  arrays.forEach(gamelist => {
    fs.writeFileSync(join("data", "v1", "names", gamelist[0].Name[0].toLowerCase() + '.json'),
      JSON.stringify(gamelist.map(element => [element.Name, parseFloat(element.x), parseFloat(element.y)])));
  });
}

function writeVoronoi(subgraphs) {
  var i = 0;
  let mygeojson = { "type": "FeatureCollection", "features": [] }
  var hulls = [];
  subgraphs.forEach(subgraph => {
    var nodes = [];
    subgraph.forEachNode(node => {
      nodes.push(node.data.l.split(',').map(coord => parseFloat(coord)))
    })

    hulls.push(d3.geoVoronoi(nodes).hull());
  })

  hulls.forEach(hull => {
    if (hull != null) {
      let feature = { "type": "Feature", "id": i, "geometry": hull, "properties": { "fill": "#00529c" } }
      mygeojson.features.push(feature);
      i = i + 1;
    }
  })
  fs.writeFileSync('./data/v1/borders.geojson', JSON.stringify(mygeojson), function (err) {
    if (err) {
      console.log(err);
    }
  })
}

function writeGeojson() {
  const directoryPath = './data/v1/graphs';
  var pointsDot = [];
  let filenames = fs.readdirSync(directoryPath)

  filenames.forEach(file => {
    const filePath = path.join(directoryPath, file);

    var t = fromDot(fs.readFileSync(filePath).toString())
    t.forEachNode(node => {
      pointsDot.push(node);
    })
  });

  let mygeojson = { "type": "FeatureCollection", "features": [] }
  for (let point of pointsDot) {
    let feature = { "type": "Feature", "geometry": { "type": "Point", "coordinates": point.data.l.slice(0, -1).split(",").map(str => parseFloat(str)) }, "properties": { "name": point.data.label, "size": point.data.weight } }
    mygeojson.features.push(feature);
  }
  fs.writeFileSync('./data/v1/geojson/points.geojson', JSON.stringify(mygeojson), function (err) {
    if (err) {
      console.log(err);
    }
  });

  execSync('tippecanoe --no-tile-compression -zg --drop-densest-as-needed --extend-zooms-if-still-dropping --output-to-directory data/v1/points data/v1/geojson/points.geojson --force');
}

function groupByName(strings) {
  // Create an object to hold the groups
  const groups = {};

  // Iterate through the sorted list of strings
  strings.forEach(string => {
    // Get the first character of the current string
    //console.log(string)
    const firstChar = string.Name.charAt(0).toLowerCase();

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
