
import express from 'express'
import cors from 'cors'; 
import fs from "fs";
const app = express()
const port = 3010
var i=0;
// Add headers before the routes are defined
app.use(cors()); 

app.get('/', (req, res) => {
  res.send('Hello World!')
})
app.post("/", (r, s) => {
  var body = "";
  r.on('readable', function() {
      body += r.read();
  });
  r.on('end', function() {
    try {
    
      console.log("Writing "+ i + '.dot')
      //const newLocal = JSON.parse(body);
      fs.writeFileSync(i  + '.dot',  body.slice(0, -4));
      // file written successfully
      i=i+1;
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