<script>
import createGraphScene from './lib/createGraphScene';

export default {
  data() {
    return {
      stepCount: 2000
    }
  },

  methods: {
    runLayout() {
      this.scene.runLayout(this.stepCount);
    },
    toggleLabel(){
      this.scene.toggleLabel();
    },
    louvain(){
      this.scene.louvain();
    },
    separateClusters(){
      this.scene.separateClusters();
    },
    coarsenGraph(){
      this.scene.coarsenGraph();
    }
  },

  mounted() {
    const canvas = document.getElementById('cnv');
    this.scene = createGraphScene(canvas);
  },

  beforeUnmount() {
    if (this.scene) this.scene.dispose();
  }
}
</script>

<template>
  <a href="#" @click.prevent='runLayout' class='btn-command'>Make {{stepCount}} layout steps</a>
  <a href="#" @click.prevent='toggleLabel' class='btn-command'>Togle Label</a>
  <a href="#" @click.prevent='louvain' class='btn-command'>Louvain</a>
  <a href="#" @click.prevent='separateClusters' class='btn-command'>Separate clusters</a>
  <a href="#" @click.prevent='coarsenGraph' class='btn-command'>Coarsen</a>
</template>

<style>
#app {
  position: absolute;
}

.row {
  display: flex;
  flex-direction: row;
  align-items: baseline;
}

.row .label {
  flex: 1;
}
.row .value {
  flex: 1;
}
.row select {
  width: 100%;
}
.btn-command {
  display: block;
  padding: 4px;
  margin-top: 10px;
  border: 1px solid;
}

a {
  color: rgb(244, 244, 244);
  text-decoration: none;
  text-align: center;
  padding: 0 4px
}
</style>
