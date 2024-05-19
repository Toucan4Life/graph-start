
import express from 'express'
import cors from 'cors';
import fs from "fs";
import serveIndex from "serve-index";
import path from "path"
const app = express()
const port = 3010
var i = 0;

// Add headers before the routes are defined
app.use(cors());

import { fileURLToPath } from 'url';

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

      console.log("Writing " + i + '.dot')
      //const newLocal = JSON.parse(body);
      fs.writeFileSync(i + '.dot', body.slice(0, -4));
      // file written successfully
      i = i + 1;
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