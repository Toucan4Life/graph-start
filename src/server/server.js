
import express from 'express'
import cors from 'cors';
import fs from "fs";
import serveIndex from "serve-index";
import path from "path"
import fromDot from 'ngraph.fromdot';
import toDot from 'ngraph.todot';
const app = express()
const port = 3010
var i = 0;

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

app.post("/graphs", (r, s) => {
  var body = "";
  r.on('readable', function () {
    body += r.read();
  });
  r.on('end', function () {
    var subgraphs = JSON.parse(body.slice(0, -4));
    var i =0;
    subgraphs.forEach(function (subgraphjson) {
      var subgraph = fromDot(subgraphjson)
      try {
        //const newLocal = JSON.parse(body);
        fs.writeFileSync(join("data", "v1", "graphs", i + '.dot'), toDot(subgraph));
        // file written successfully
        i=i+1
      } catch (err) {
        console.error(err);
      }
    });
    s.write("OK");
    s.end();
  });

})

app.post("/names", (r, s) => {
  var body = "";
  r.on('readable', function () {
    body += r.read();
  });
  r.on('end', function () {
    try {

      // console.log("Writing " + r.headers.firstchar + '.names')
      //const newLocal = JSON.parse(body);
      fs.writeFileSync(join("data","v1", "names", r.headers.firstchar.toLowerCase() + '.json'), body.slice(0, -4));
      // file written successfully
    } catch (err) {
      console.error(err);
    }
    s.write("OK");
    s.end();
  });

})

app.post("/geojson", (r, s) => {
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
  fs.writeFile('./data/v1/geojson/points.geojson', JSON.stringify(mygeojson), function (err) {
    if (err) {
      console.log(err);
    }
  });
  //execSync('tippecanoe --no-tile-compression -zg --drop-densest-as-needed --extend-zooms-if-still-dropping --output-to-directory data/v1/points data/v1/geojson/points.geojson --force');
  s.write("OK");
  s.end();
})

app.post("/borders", (r, s) => {
  var body = "";
  var i = 0;
  let mygeojson = { "type": "FeatureCollection", "features": [] }
  r.on('readable', function () {
    body += r.read();
  });
  r.on('end', function () {
    try {
      //console.log(body.slice(0, -4));
      JSON.parse(body.slice(0, -4)).forEach(hull => {
        if (hull != null) {
          let feature = { "type": "Feature", "id": i, "geometry": hull, "properties": { "fill": "#00529c" } }
          mygeojson.features.push(feature);
          i = i + 1;
        }
      })
      fs.writeFile('./data/v1/borders.geojson', JSON.stringify(mygeojson), function (err) {
        if (err) {
          console.log(err);
        }
      })
      // file written successfully
    } catch (err) {
      console.error(err);
    }
    s.write("OK");
    s.end();
  });
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})