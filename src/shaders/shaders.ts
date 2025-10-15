// CHECKITOUT: this file loads all the shaders and preprocesses them with some common code

import { Camera } from "../stage/camera";
import type { ClusterSize } from "../types";
import { canvas } from "../renderer";

import commonRaw from "./common.wgsl?raw";

import naiveVertRaw from "./naive.vs.wgsl?raw";
import naiveFragRaw from "./naive.fs.wgsl?raw";

import forwardPlusFragRaw from "./forward_plus.fs.wgsl?raw";

import clusteredDeferredFragRaw from "./clustered_deferred.fs.wgsl?raw";
import clusteredDeferredFullscreenVertRaw from "./clustered_deferred_fullscreen.vs.wgsl?raw";
import clusteredDeferredFullscreenFragRaw from "./clustered_deferred_fullscreen.fs.wgsl?raw";

import moveLightsComputeRaw from "./move_lights.cs.wgsl?raw";
import clusteringComputeRaw from "./clustering.cs.wgsl?raw";

// CONSTANTS (for use in shaders)
// =================================

// CHECKITOUT: feel free to add more constants here and to refer to them in your shader code

// Note that these are declared in a somewhat roundabout way because otherwise minification will drop variables
// that are unused in host side code.
export const constants = {
  bindGroup_scene: 0,
  bindGroup_model: 1,
  bindGroup_material: 2,

  moveLightsWorkgroupSize: 128,

  lightRadius: 2,
};

// =================================

function evalShaderRaw(raw: string) {
  return eval("`" + raw.replaceAll("${", "${constants.") + "`");
}

const commonSrc: string = evalShaderRaw(commonRaw);

function processShaderRaw(raw: string) {
  return commonSrc + evalShaderRaw(raw);
}

export const naiveVertSrc: string = processShaderRaw(naiveVertRaw);
export const naiveFragSrc: string = processShaderRaw(naiveFragRaw);

export const forwardPlusFragSrc: string = processShaderRaw(forwardPlusFragRaw);

export const clusteredDeferredFragSrc: string = processShaderRaw(clusteredDeferredFragRaw);
export const clusteredDeferredFullscreenVertSrc: string = processShaderRaw(
  clusteredDeferredFullscreenVertRaw
);
export const clusteredDeferredFullscreenFragSrc: string = processShaderRaw(
  clusteredDeferredFullscreenFragRaw
);

export const moveLightsComputeSrc: string = processShaderRaw(moveLightsComputeRaw);

let warnOnce = true;

export function getClusteringComputeWorkgroupSizes(clusterSize: ClusterSize, maxDepth: number) {
  if (maxDepth <= Camera.nearPlane) {
    throw Error("Max depth cannot be <= Camera.nearPlane!");
  }

  const x = Math.ceil(canvas.width / clusterSize.x);
  const y = Math.ceil(canvas.height / clusterSize.y);

  const theoreticalSizeZ = Math.ceil((maxDepth - Camera.nearPlane) / clusterSize.z);
  const maxSizeZ = Math.floor(256 / (x * y));

  let z: number;
  if (theoreticalSizeZ > maxSizeZ) {
    if (warnOnce) {
      console.warn(
        `Warning: requested workgroup Z size (${theoreticalSizeZ}) is bigger than max allowed (${maxSizeZ}) due to X * Y = ${x} * ${y} = ${
          x * y
        }, and Math.floor(256 / ${x * y}) = max Z = ${maxSizeZ}. Using Z = ${maxSizeZ} instead.`
      );
      warnOnce = false;
    }

    z = maxSizeZ;
  } else {
    z = theoreticalSizeZ;
  }

  return { x, y, z };
}

export function getClusteringComputeSrc(clusterSize: ClusterSize, maxDepth: number) {
  console.log("Current cluster size:", clusterSize);
  console.log(`Canvas height: ${canvas.height}, width: ${canvas.width}`);

  const workgroupSize = getClusteringComputeWorkgroupSizes(clusterSize, maxDepth);

  console.log("Using workgroup sizes ", workgroupSize);

  const evaluated = eval("`" + clusteringComputeRaw.replaceAll("${", "${workgroupSize.") + "`");

  console.log(`Evaluated clustering compute shader:\n\n${evaluated}`);

  return evaluated;
}
