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
import axios from 'axios'
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
    ship
  };

  function loadGraph(newGraph) {
    addedSprings = [];
    nodeInSubgraph = new Object();
    linkToRemove = [];
    subgraphs = [];
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
    layoutSteps += stepsCount;
  }

  function cut(threshold) {
    console.log("cutting...")
    var linkToRemovelocal = []
    graph.forEachLink(link => {
      if (link.data.weight < threshold
        //&& graph.getLinks(link.fromId).some(links=> links.data.weight > link.data.weight) 
        //&& graph.getLinks(link.toId).some(links=> links.data.weight > link.data.weight)
      ) {
        link.ui.color = 0x000000
        //linkToRemovelocal.push(link)
      }
    })
    //linkToRemovelocal.forEach(link => graph.removeLink(link))
    console.log("cutting done")
  }

  function coarsenGraph() {
    console.log("Coarsin...")
    // if (clusters != undefined) {
    //   const newLocal = coarsen(graph, clusters);
    //   loadGraph(newLocal);
    // }

    //graph.forEachNode((node) => console.log("graph node: " + node.id))
    var cgraph = coarsen(graph, clusters);


    coarsen.getSubgraphs(cgraph).forEach(function (subgraph) {
      subgraphs.push(subgraph)
      var p = [];
      subgraph.graph.forEachNode(function (node) {
        p.push(node.id);
        //console.log(node);
      });
      nodeInSubgraph[subgraph.id] = p;
    })

    cgraph.forEachLink((link) => {
      if (link.toId != link.fromId) {
        //console.log("link: " + x[link.fromId] + ' => ' + x[link.toId])
        var bodies_from = layout.getBody(nodeInSubgraph[link.fromId][0]);
        var bodies_to = layout.getBody(nodeInSubgraph[link.toId][0]);
        addedSprings.push(layout.simulator.addSpring(bodies_from, bodies_to, 300, 0.8));
      }

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
    var linkToAdd = [];
    console.log("reattaching...")
    var froms = [];
    console.log(subgraphs)
    if (clusters != undefined) {
      for (const [key, value] of Object.entries(nodeInSubgraph)) {
        if (value.length <= size) {
          //console.log(key, value);
          //console.log(addedSprings[0]);
          addedSprings.filter(spring => value.includes(spring.from.id) || value.includes(spring.to.id)).forEach(spring => layout.simulator.removeSpring(spring))
          const newLocal_1 = linkToRemove.filter(link => clusters.getClass(link.fromId) == key || clusters.getClass(link.toId) == key);
          const newLocal = newLocal_1.reduce((seed, item) => { return (seed && seed.data.weight > item.data.weight) ? seed : item; }, null);
          //console.log("link found " + newLocal.toId.toString() + " " + newLocal.fromId.toString() + " " + newLocal.data.weight)
          var graphFrom = subgraphs.find(subgraph => subgraph.id == key);
          froms.push(graphFrom.id)
          if (newLocal != null) {
            linkToAdd.push(newLocal)
            var clusterTo = clusters.getClass(newLocal.fromId) == key ? clusters.getClass(newLocal.toId) : clusters.getClass(newLocal.fromId)
            //console.log("need to merge cluster " + key + " into cluster " + clusterTo);
            var graphTo = subgraphs.find(subgraph => subgraph.id == clusterTo);
            graphFrom.graph.forEachNode(node => graphTo.graph.addNode(node.id, node.data))
            graphFrom.graph.forEachLink(link => graphTo.graph.addLink(link.fromId, link.toId, link.data))
            graphTo.graph.addLink(newLocal.fromId, newLocal.toId, newLocal.data)
            subgraphs.forEach((item, i) => { if (item.id == graphTo.id) subgraphs[i] = graphTo; });
          }
        }
      }
      subgraphs = subgraphs.filter((item) => !froms.includes(item.id))
      console.log(subgraphs)
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

  // function coarseOnce() {
  //   //does not work because resulting graph is not same type as previous graph and we dont find link.ui property
  //   console.log(clusters);
  //   console.log(clusters != undefined);
  //   if (clusters != undefined) {
  //     if (!clusters.canCoarse()) { console.log('Cant coarse'); return }
  //     console.log('coarsing baby');
  //     graph = coarsen(graph, clusters);
  //     clusters = detectClusters(graph);
  //     recolorNode(graph, clusters, layout, getColor);
  //   }
  // }

  function separateClusters() {
    console.log("Separating...")
    if (clusters != undefined) {
      graph.forEachLink(link => {
        if (link != undefined && clusters.getClass(link.fromId) != clusters.getClass(link.toId)) {
          linkToRemove.push(link);
        }

      });

      linkToRemove.forEach((link) => { graph.removeLink(link); });
      scene.dispose();
      scene = null
      scene = initScene();
      initUIElements(false);
    }

    console.log("Separating done")
  }

  function louvain() {
    console.log("Louvain...")
    clusters = detectClusters(graph);
    recolorNode(graph, clusters, layout, getColor);
    console.log("Louvain done")
  }

  function ship() {
    console.log("Shipping...")

    subgraphs.forEach(function (subgraph) {

      var dotContent = toDot(subgraph.graph)
      try {
        fetch("http://127.0.0.1:3010/", {
          method: "POST",
          body: dotContent,
          headers: {
            "Content-type": "application/json; charset=UTF-8"
          }
        });
      } catch (error) {
        console.log("There was a problem adding posting")
      }
    })
    console.log("Shippping done")
  }

  function getColor(id) {
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
        limit: node.ui.size,
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

    node.ui = { size, position: [point.x, point.y, point.z || 0], color: getColor(currentClass) };
  });
}
