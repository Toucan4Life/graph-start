import { createScene } from 'w-gl';
import LineCollection from './LineCollection';
import PointCollection from './PointCollection';
import MSDFTextCollection from './MSDFTextCollection';
import bus from './bus';
import getGraph from './getGraph';
import createLayout from 'ngraph.forcelayout';
import detectClusters from 'ngraph.louvain';
import coarsen from 'ngraph.coarsen';
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

  loadGraph(getGraph());
  bus.on('load-graph', loadGraph);

  return {
    dispose,
    runLayout,
    toggleLabel,
    louvain,
    separateClusters,
    coarsenGraph
  };

  function loadGraph(newGraph) {
    if (scene) {
      scene.dispose();
      scene = null
      cancelAnimationFrame(rafHandle);
    }
    scene = initScene();
    graph = newGraph

    layout = createLayout(graph, {
      timeStep: 0.5,
      springLength: 10,
      springCoefficient: 0.8,
      gravity: -12,
      dragCoefficient: 0.9,
    });

    layout.step();
    initUIElements();

    rafHandle = requestAnimationFrame(frame);
  }

  function runLayout(stepsCount) {
    layoutSteps += stepsCount;
  }

  function coarsenGraph() {
    if (clusters != undefined) {
      loadGraph(coarsen(graph, clusters));
    }
  }

  function toggleLabel() {
    drawLabels = !drawLabels;
  }

  function separateClusters() {
    if (clusters != undefined) {
      var linkToRemove = [];
      graph.forEachLink(link => {
        if (link != undefined && clusters.getClass(link.fromId) != clusters.getClass(link.toId)) {
          linkToRemove.push(link);
        }

      });

      linkToRemove.forEach((link) => { graph.removeLink(link); });
    }
  }

  function louvain() {
    clusters = detectClusters(graph);
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
    scene.setClearColor(12 / 255, 41 / 255, 82 / 255, 1)
    let initialSceneSize = 40;
    scene.setViewBox({
      left: -initialSceneSize,
      top: -initialSceneSize,
      right: initialSceneSize,
      bottom: initialSceneSize,
    });
    return scene;
  }

  function initUIElements() {
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

      size=1;
      node.ui = { size, position: [point.x, point.y, point.z || 0], color: 0x90f8fcff };
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