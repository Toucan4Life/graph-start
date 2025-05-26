declare module 'ngraph.todot' {
  import { Graph } from 'ngraph.graph';
  export default function load<NodeData, LinkData>(dotGraph: Graph<NodeData, LinkData>): string
}
