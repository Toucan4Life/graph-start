import { createScene } from 'w-gl';
import LineCollection from './LineCollection';
import PointCollection from './PointCollection';
import MSDFTextCollection from './MSDFTextCollection';
import bus from './bus';
import getGraph from './getGraph';
import createLayout from 'ngraph.forcelayout';
import detectClusters from 'ngraph.louvain';
import coarsen from 'ngraph.coarsen';
import toDot from 'ngraph.todot';
import createGraph from 'ngraph.graph';

export default function createGraphScene(canvas) {
  let drawLinks = true;
  let drawLabels = true;

  // Since graph can be loaded dynamically, we have these uninitialized
  // and captured into closure. loadGraph will do the initialization
  let graph, layout;
  let scene, nodes, lines, labels;

  let layoutSteps = 0; // how many frames shall we run layout?
  let rafHandle;
  let colors = [
    0x1f77b4, 0xaec7e8,
    0xff7f0e, 0xffbb78,
    0x2ca02c, 0x98df8a,
    0xd62728, 0xff9896,
    0x9467bd, 0xc5b0d5,
    0x8c564b, 0xc49c94,
    0xe377c2, 0xf7b6d2,
    0x7f7f7f, 0xc7c7c7,
    0xbcbd22, 0xf44336,
  ];
  let clusters = undefined;
  let lastUsed = 0;
  let idToIndex = Object.create(null);
  var nodeInSubgraph = new Object();
  var linkToRemove = [];
  var addedSprings = [];
  var subgraphs = [];
  var resizeX = 0;
  var resizeY = 0;
  var pinnedNdes = [];
  var clusterGraph = new Object();
  var originalGraph;
  loadGraph(getGraph());
  bus.on('load-graph', loadGraph);

  return {
    dispose,
    runLayout,
    toggleLabel,
    toggleLink,
    louvain,
    separateClusters,
    coarsenGraph,
    reattachNode,
    cut,
    ship,
    pin
  };

  function loadGraph(newGraph) {
    addedSprings = [];
    // nodeInSubgraph = new Object();
    linkToRemove = [];
    // subgraphs = [];
    clusterGraph = new Object();
    resizeX = 0;
    resizeY = 0;
    if (scene) {
      scene.dispose();
      scene = null
      cancelAnimationFrame(rafHandle);
    }
    scene = initScene();
    graph = newGraph
    layout = createLayout(graph, {
      timeStep: 1,
      springLength: 10,
      springCoefficient: 0.8,
      gravity: -12,
      dragCoefficient: 0.9,
    });

    layout.step();
    initUIElements(true);

    rafHandle = requestAnimationFrame(frame);
  }

  function runLayout(stepsCount) {
    if (layoutSteps > 0) {
      layoutSteps = 0
    } else {
      layoutSteps += stepsCount;
    }
  }

  function cut(quantileNumber) {
    // sort array ascending
    const asc = arr => arr.sort((a, b) => a - b);

    const quantile = (arr, q) => {
      const sorted = asc(arr);
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
      } else {
        return sorted[base];
      }
    };
    console.log("cutting...")
    var linkToRemovelocal = []

    // subgraphs.forEach(subgraph => {
    //   var significance = []
    //   subgraph.graph.forEachLink(link => {
    //     //  console.log(link);
    //     significance.push(link.data.significance)
    //   })
    //  // console.log(significance)
    //   var threshold = quantile(significance, parseFloat(quantileNumber) / 100)
    //   //console.log(threshold)
    //   subgraph.graph.forEachLink(link => {
    //     if (link.data.significance < threshold) {
    //       linkToRemovelocal.push(link)
    //     }
    //   })

    // })

    var significance = []
    graph.forEachLink(link => {
      //  console.log(link);
      significance.push(link.data.significance)
    })
    //console.log(significance)
    var threshold = quantile(significance, parseFloat(quantileNumber) / 100)
    //console.log(threshold)
    graph.forEachLink(link => {
      if (link.data.significance < threshold) {
        linkToRemovelocal.push(link)
      }
    })


    console.log(linkToRemovelocal)
    linkToRemovelocal.forEach(link => { graph.removeLink(link) })

    scene.dispose();
    scene = null
    scene = initScene();
    initUIElements(false);
    console.log("cutting done")
  }

  function coarsenGraph(interdist) {
    console.log("Coarsin...")

    // console.log(toDot(graph))
    originalGraph = graph;
    clusterGraph = coarsen(graph, clusters);
    //var subgraphs = coarsen.getSubgraphs(clusterGraph);
    //clusterGraph.forEachNode(node => console.log(node))
    // console.log(interdist)
    let layoutC = createLayout(clusterGraph, {
      timeStep: 0.2,
      springLength: 10,
      springCoefficient: 0.8,
      gravity: -12,
      dragCoefficient: 0.9,
    });

    let i = 0;

    while (i < 100) {
      layoutC.step()
      // console.log("stepping...")
      i = i + 1;
    }
    var box = layoutC.getGraphRect();
    var center = [(box.max_x + box.min_x) / 2, (box.max_y + box.min_y) / 2]
    clusterGraph.forEachNode(cNode => {
      var nodes = [];
      cNode.data.forEach(n => {
        var node = graph.getNode(n);
        if (node.data === undefined) {
          node.data = new Object()
        }
        if (node.data.weight === undefined) {
          node.data.weight = 1
        }
        nodes.push(node)
      })

      var chosen_node = nodes.reduce((seed, item) => { return (seed && seed.data.weight > item.data.weight) ? seed : item; }, null);
      var graph_position = layoutC.getNodePosition(cNode.id);

      layout.setNodePosition(chosen_node.id, (graph_position.x - center[0]) * interdist, (graph_position.y - center[1]) * interdist)

      layout.pinNode(chosen_node, true)
      pinnedNdes.push([chosen_node, (graph_position.x - center[0]) * interdist, (graph_position.y - center[1]) * interdist, cNode.data])
    })

    console.log("Coarsin done")
  }

  function toggleLabel() {
    drawLabels = !drawLabels;
  }

  function toggleLink() {
    drawLinks = !drawLinks;
  }

  function reattachNode(size) {
    console.log("reattaching...")
    var linkToAdd = [];
    var froms = [];
    //console.log(subgraphs)
    if (clusters != undefined) {
      for (const [key, value] of Object.entries(nodeInSubgraph)) {
        if (value.length <= size) {
          var links = [];
          // console.log("deleting subgraph")
          // console.log(key)
          value.forEach(nodeid => {
            var node = originalGraph.getNode(nodeid)
            links = links.concat(node.links)
          })

          links = links.filter(link => clusters.getClass(link.fromId) != clusters.getClass(link.toId));
          var newLocal = links.reduce((seed, item) => { return (seed && seed.data.weight > item.data.weight) ? seed : item; }, null);
          linkToAdd.push(newLocal);
          froms.push(parseInt(key))
          if (newLocal != null) {
            var graphFrom = subgraphs.find(subgraph => subgraph.id == key);
            var clusterTo = clusters.getClass(newLocal.fromId) == key ? clusters.getClass(newLocal.toId) : clusters.getClass(newLocal.fromId)
            //console.log("need to merge cluster " + key + " into cluster " + clusterTo);
            var graphTo = subgraphs.find(subgraph => subgraph.id == clusterTo);
            graphFrom.graph.forEachNode(node => graphTo.graph.addNode(node.id, node.data))
            graphFrom.graph.forEachLink(link => graphTo.graph.addLink(link.fromId, link.toId, link.data))
            graphTo.graph.addLink(newLocal.fromId, newLocal.toId, newLocal.data)
            subgraphs.forEach((item, i) => { if (item.id == graphTo.id) subgraphs[i] = graphTo; });

            var nodeToId = clusters.getClass(newLocal.fromId) == key ? newLocal.toId : newLocal.fromId
            var position = layout.getNodePosition(nodeToId)

            value.forEach(nodeid => {
              //console.log("setting node : " +nodeid +"to position of node : " + nodeToId)
              layout.setNodePosition(nodeid, position.x, position.y)
            })
          }
        }
      }

      //console.log(froms)
      subgraphs = subgraphs.filter((item) => !froms.includes(item.id))
      // console.log("resulting subgraph")
      // console.log(subgraphs)
      // console.log(linkToAdd)

      linkToAdd.forEach((link) => {
        if (link != null) {
          graph.addLink(link.fromId, link.toId, link.data)
        }
      })
      scene.dispose();
      scene = null
      scene = initScene();
      initUIElements(false);
    }
    console.log("reattaching done")
  }

  function separateClusters() {
    console.log("Separating...")
    var tempGraph = createGraph();
    subgraphs = coarsen.getSubgraphs(clusterGraph);
    subgraphs.forEach(subgraph => {
      subgraph.graph.forEachNode(node => {
        tempGraph.addNode(node.id, node.data)
      });
      subgraph.graph.forEachLink(link => {
        tempGraph.addLink(link.fromId, link.toId, link.data)
      })
      var p = [];
      subgraph.graph.forEachNode(function (node) {
        p.push(node.id);
      });
      nodeInSubgraph[subgraph.id] = p;
    })

    loadGraph(tempGraph)

    pinnedNdes.forEach(node => {
      //layout.setNodePosition(node[0].id, node[1], node[2])
      node[3].forEach(nodeid => layout.setNodePosition(nodeid, node[1], node[2]))
      //layout.pinNode(node[0], true)
    })

    console.log("Separating done")
  }

  function pin() {
    pinnedNdes.forEach(node => {
      layout.pinNode(node[0], !layout.isNodePinned(node[0]))
    })

  }
  function louvain() {
    console.log("Louvain...")
    clusters = detectClusters(graph);
   // console.log(JSON.stringify(clusters))
    recolorNode(graph, clusters, layout, getColor);
    console.log("Louvain done")
  }

  function ship() {
    console.log("Shipping...")
    var box = layout.getGraphRect();
    resizeX = 90.0 / (box.max_x - box.min_x);
    resizeY = 90.0 / (box.max_y - box.min_y);
    subgraphs.forEach(function (subgraph) {
      subgraph.graph.forEachNode(node => {

        var newLocal = layout.getNodePosition(node.id);
        if (node.data === undefined) {
          node.data = new Object();
        }
        node.data.l = (newLocal.x * resizeX).toFixed(3) + "," + (newLocal.y * resizeY).toFixed(3);
      });
    })
    var t = subgraphs.map(graph => toDot(graph.graph))
    try {
      fetch("http://127.0.0.1:3010/ship", {
        method: "POST",
        body: JSON.stringify(t),
        headers: {
          "Content-type": "application/json; charset=UTF-8"
        }
      }).then(function (response) {
      });
    } catch (error) {
      console.log("There was a problem adding posting")
    }
    console.log("Shippping done")
  }

  function getColor(id) {
    //console.log(id)
    var idx = idToIndex[id];
    if (idx === undefined) {
      idx = idToIndex[id] = lastUsed;
      lastUsed += 1;
    }
    return colors[idx];
  }

  function initScene() {
    let scene = createScene(canvas);
    scene.setClearColor(0, 0, 0, 1)
    let initialSceneSize = 40;
    scene.setViewBox({
      left: -initialSceneSize,
      top: -initialSceneSize,
      right: initialSceneSize,
      bottom: initialSceneSize,
    });
    return scene;
  }

  function initUIElements(shouldEraseColor) {
    nodes = new PointCollection(scene.getGL(), {
      capacity: graph.getNodesCount()
    });

    graph.forEachNode(node => {
      var point = layout.getNodePosition(node.id);
      let size = 1;
      if (node.data && node.data.size) {
        size = node.data.size;
      } else {
        if (!node.data) node.data = {};
        node.data.size = size;
      }

      size = 1;
      if (shouldEraseColor) { node.ui = { size, position: [point.x, point.y, point.z || 0], color: 0x90f8fcff }; }
      else { node.ui = { size, position: [point.x, point.y, point.z || 0], color: node.ui.color }; }
      node.uiId = nodes.add(node.ui);
    });

    lines = new LineCollection(scene.getGL(), { capacity: graph.getLinksCount() });

    graph.forEachLink(link => {
      var from = layout.getNodePosition(link.fromId);
      var to = layout.getNodePosition(link.toId);
      var line = { from: [from.x, from.y, from.z || 0], to: [to.x, to.y, to.z || 0], color: 0xFFFFFF10 };
      link.ui = line;
      link.uiId = lines.add(link.ui);
    });


    scene.appendChild(lines);
    scene.appendChild(nodes);
    if (drawLabels) {
      labels = new MSDFTextCollection(scene.getGL());
      redrawLabels();
      scene.appendChild(labels);
    }
  }

  function frame() {
    rafHandle = requestAnimationFrame(frame);

    if (layoutSteps > 0) {
      layoutSteps -= 1;
      layout.step();

      // const newLocal = layout.getNodePosition(1);
      // console.log("\""+newLocal.x.toFixed(3)+","+newLocal.y.toFixed(3)+"\"")
      // Drawing labels is heavy, so avoid it if we don't need it
      redrawLabels();
    }
    drawGraph();
    scene.renderFrame();
  }

  function drawGraph() {
    graph.forEachNode(node => {
      let pos = layout.getNodePosition(node.id);
      let uiPosition = node.ui.position;
      uiPosition[0] = pos.x;
      uiPosition[1] = pos.y;
      uiPosition[2] = pos.z || 0;
      nodes.update(node.uiId, node.ui)
    });

    if (drawLinks) {
      graph.forEachLink(link => {
        var fromPos = layout.getNodePosition(link.fromId);
        var toPos = layout.getNodePosition(link.toId);
        let { from, to } = link.ui;
        from[0] = fromPos.x; from[1] = fromPos.y; from[2] = fromPos.z || 0;
        to[0] = toPos.x; to[1] = toPos.y; to[2] = toPos.z || 0;
        lines.update(link.uiId, link.ui);
      })
    }
  }

  function redrawLabels() {
    if (!drawLabels) return;
    labels.clear();
    graph.forEachNode(node => {
      const text = '' + ((node.data && node.data.label) || node.id);

      labels.addText({
        text,
        x: node.ui.position[0],
        y: node.ui.position[1] - node.ui.size / 2,
        limit: 4,
        cx: 0.5
      });
    });
  }

  function dispose() {
    cancelAnimationFrame(rafHandle);

    scene.dispose();
    bus.off('load-graph', loadGraph);
  }
}

function recolorNode(graph, clusters, layout, getColor) {
  var b = []
  graph.forEachNode(node => {
    var currentClass = clusters.getClass(node.id);
    var point = layout.getNodePosition(node.id);
    let size = 1;
    if (node.data && node.data.size) {
      size = node.data.size;
    } else {
      if (!node.data) node.data = {};
      node.data.size = size;
    }
    b.push(currentClass)
    node.ui = { size, position: [point.x, point.y, point.z || 0], color: getColor(currentClass) };
  });
  let uniqueItems = [...new Set(b)]
  console.log(JSON.stringify(uniqueItems))
}
