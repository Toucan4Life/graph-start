<script>
import createGraphScene from './lib/createGraphScene';
import { ref } from 'vue'



export default {
  
  data() {
    return {
      message: '',
      stepCount: 2000,
      treshold:0,
      interdist:6
    }
  },

  methods: {
    knn(){
      this.scene.knn();
    },
    runLayout() {
      this.scene.runLayout(this.stepCount);
    },
    toggleLabel(){
      this.scene.toggleLabel();
    },
    toggleLink(){
      this.scene.toggleLink();
    },
    louvain(){
      this.scene.louvain();
    },
    separateClusters(){
      this.scene.separateClusters();
    },
    coarsenGraph(){
      this.scene.coarsenGraph(this.interdist);
    },
    reattachNode(){
      this.scene.reattachNode(this.message);
    },
    cut(){
      this.scene.cut(this.threshold);
    },
    ship(){
      this.scene.ship();
    },
    pin(){
      this.scene.pin();
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
  <a href="#" @click.prevent='knn' class='btn-command'>KNN</a>
  <a href="#" @click.prevent='runLayout' class='btn-command'>Toggle simulation</a>
  <a href="#" @click.prevent='toggleLabel' class='btn-command'>Toggle Label</a>
  <a href="#" @click.prevent='toggleLink' class='btn-command'>Toggle Link</a>
  <a href="#" @click.prevent='louvain' class='btn-command'>Louvain</a>
  <a href="#" @click.prevent='coarsenGraph' class='btn-command'>Coarsen</a>
	<input v-model="interdist" placeholder="internode distance" />
  <a href="#" @click.prevent='separateClusters' class='btn-command'>Separate clusters</a>
  <a href="#" @click.prevent='pin' class='btn-command'>Toggle pin clusters</a>
  <a href="#" @click.prevent='reattachNode' class='btn-command'>reattach nodes</a> 
	<input v-model="message" placeholder="reattach node below count:" />
  <a href="#" @click.prevent='cut' class='btn-command'>cut (%)</a> 
	<input v-model="threshold" placeholder="cut threshold" />
  <a href="#" @click.prevent='ship' class='btn-command'>Ship it !</a>
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
