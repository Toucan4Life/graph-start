declare module 'ngraph.fromdot' {
  import { Graph } from 'ngraph.graph';
  export default function load<NodeData, LinkData>(dotGraph: string, appendTo?: Graph<NodeData, LinkData>): Graph<NodeData, LinkData>
}
