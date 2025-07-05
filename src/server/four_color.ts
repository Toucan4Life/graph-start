//from https://github.com/StoneCypher/four_color.js

'use strict';

// Type definitions
type Vertex = {
  neighbors: number[];
  color?: number;
};

type Solution = number[];

/**
 * Generate a 4-coloring through backtracking.
 * @param solutions Array to collect all valid colorings.
 * @param vertices Array of vertices with neighbor info and color.
 * @param whichVertex Index of the current vertex being colored.
 * @param work (Unused) Work array for intermediate state.
 * @param stopAtOne If true, stop after finding the first solution.
 * @returns The first solution if stopAtOne is true, otherwise undefined.
 */
function gen4col_bt(
  solutions: Solution[],
  vertices: Vertex[],
  whichVertex: number,
  stopAtOne: boolean
): Solution | undefined {
  for (let color = 0; color < 4; ++color) {
    let color_burned = false;

    for (
      let neighbor = 0, neighborCap = vertices[whichVertex].neighbors.length;
      neighbor < neighborCap && !color_burned;
      ++neighbor
    ) {
      if (vertices[vertices[whichVertex].neighbors[neighbor]].color === color) {
        color_burned = true;
      }
    }

    if (!color_burned) {
      vertices[whichVertex].color = color;

      if (whichVertex === vertices.length - 1) {
        solutions.push(vertices.map((v) => v.color!));
        if (stopAtOne) {
          return solutions[0];
        }
      } else {
        const oneRowResult = gen4col_bt(
          solutions,
          vertices,
          whichVertex + 1,
          stopAtOne
        );
        if (oneRowResult) {
          return oneRowResult;
        }
      }

      vertices[whichVertex].color = undefined;
    }
  }
}

/**
 * Generate all 4-colorings for a graph described by neighbor arrays.
 * @param vertices Array of neighbor arrays.
 * @param stopAtOne If true, stop after finding the first solution.
 * @returns All solutions or the first solution.
 */
function gen4col(vertices: number[][], stopAtOne: boolean): Solution[] | Solution {
  return gen4col_obj(vertices.map((arr) => ({ neighbors: arr })), stopAtOne);
}

/**
 * Generate all 4-colorings for a graph described by Vertex objects.
 * @param vertices Array of Vertex objects.
 * @param stopAtOne If true, stop after finding the first solution.
 * @returns All solutions or the first solution.
 */
function gen4col_obj(vertices: Vertex[], stopAtOne: boolean): Solution[] | Solution {
  const solutions: Solution[] = [];
  const oneRow = gen4col_bt(solutions, vertices, 0, stopAtOne);
  return oneRow ? oneRow : solutions;
}

export { gen4col_bt, gen4col_obj, gen4col, Vertex, Solution };