
import express from 'express'
import cors from 'cors';
import fs from "fs";
import serveIndex from "serve-index";
import path from "path"
import fromDot from 'ngraph.fromdot';
const app = express()
const port = 3010
var i = 0;

// Add headers before the routes are defined
app.use(cors());

import { fileURLToPath } from 'url';
import { join } from 'path';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

var htmlPath = path.join(__dirname, 'map-of-github-data');
app.use('/data', serveIndex(htmlPath));
app.use('/data', express.static(htmlPath));

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.post("/", (r, s) => {
  var body = "";
  r.on('readable', function () {
    body += r.read();
  });
  r.on('end', function () {
    try {
      console.log("Writing " + r.headers.number + '.dot')
      //const newLocal = JSON.parse(body);
      fs.writeFileSync(join("v1", "graphs", r.headers.number + '.dot'), body.slice(0, -4));
      // file written successfully
      i = i + 1;
    } catch (err) {
      console.error(err);
    }
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

      console.log("Writing " + r.headers.firstchar + '.names')
      //const newLocal = JSON.parse(body);
      fs.writeFileSync(join("v1", "names", r.headers.firstchar + '.json'), body.slice(0, -4));
      // file written successfully
    } catch (err) {
      console.error(err);
    }
    s.write("OK");
    s.end();
  });

})

app.post("/geojson", (r, s) => {
  const directoryPath = './v1/graphs';
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
    let feature = { "type": "Feature", "geometry": { "type": "Point", "coordinates":point.data.l.slice(0, -1).split(",").map(str => (parseFloat(str)/100).toFixed(3))}, "properties": { "name": point.data.label } }
    mygeojson.features.push(feature);
  }
  fs.writeFile('./v1/geojson/points.geojson', JSON.stringify(mygeojson), function (err) {
    if (err) {
      console.log(err);
    }
  });

  s.write("OK");
  s.end();
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})