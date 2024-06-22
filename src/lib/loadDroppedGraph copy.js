import fromDot from 'ngraph.fromdot';
import fromJson from 'ngraph.fromjson';
import bus from './bus.js';
import fs from 'fs';
import { bsplit, Buffer } from 'buffer-split';
import createGraph from 'ngraph.graph'
import { LineReader } from './linereader.js';
/**
 * Loads graph from a dropped file
 */
export default function loadDroppedGraph(files) {
  console.log("Parsing graph...")
  var graph = createGraph();
  var i = 0;
  new LineReader(files[0]).readLines(function (line) {
    if (i % 10000 == 0) {
      console.log(i)
    }
    graph = tryDot2(line, graph);
    i=i+1;
  }, function () {
    console.log("Parsing graph done...")
    if (graph) bus.fire('load-graph', graph);
  });

}

function tryDot2(line, graph) {
  // console.log("Parsing : " + JSON.stringify(line))
  if (line.includes("strict digraph")) {
    //console.log("in headers")
  }
  else if (line == "}") {
    //console.log("in end")
  }
  else if (line.includes(" -> ")) {
    var newLocal = line.split("[weight=");
    var object = new Object();
    // console.log("weight : "+JSON.stringify(newLocal[1].slice(0,-1)))
    object.weight = newLocal[1].slice(0, -1);
    var edges = newLocal[0].split(" -> ");
    //console.log("edges :"+edges[0] + " / " + edges[1] + JSON.stringify(object))
    graph.addLink(edges[0], edges[1], object)
  }
  else {
    var newLocal2 = line.split("[weight=");
    var object2 = new Object();
    var newLocal3 = newLocal2[1].split(",label=\"");
    object2.weight = newLocal3[0];
    object2.label = newLocal3[1].slice(0, -2);

    //console.log("nodes :"+newLocal2[0] + JSON.stringify(object2))
    graph.addNode(newLocal2[0], object2)
  }
  return graph;
}