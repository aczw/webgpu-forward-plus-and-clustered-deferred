import { vec3 } from "wgpu-matrix";

import { canvas, device } from "../renderer";
import { Camera } from "./camera";
import { constants, moveLightsComputeSrc, clusteringComputeSrc } from "../shaders/shaders";

// h in [0, 1]
function hueToRgb(h: number) {
  let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
  return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
  private camera: Camera;

  numLights = 500;
  static readonly maxNumLights = 5000;
  static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

  static readonly lightIntensity = 0.1;

  lightsArray: Float32Array<ArrayBuffer>;
  lightSetStorageBuffer: GPUBuffer;

  timeUniformBuffer: GPUBuffer;

  moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
  moveLightsComputeBindGroup: GPUBindGroup;
  moveLightsComputePipeline: GPUComputePipeline;

  // TODO-2: add layouts, pipelines, textures, etc. needed for light clustering here
  maxDepth: number;

  dimensionsUniformBuffer: GPUBuffer;

  clusteringComputeBindGroupLayout: GPUBindGroupLayout;
  clusteringComputeBindGroup: GPUBindGroup;
  clusteringComputePipeline: GPUComputePipeline;

  numWorkgroups: { x: number; y: number; z: number };

  static readonly clusterByteSize = constants.maxLightsInCluster * 4 + 4;

  clusterSetStorageBuffer: GPUBuffer;

  constructor(camera: Camera) {
    this.camera = camera;

    this.lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);

    this.lightSetStorageBuffer = device.createBuffer({
      label: "Light set storage buffer",
      size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.populateLightsBuffer();
    this.updateLightSetUniformNumLights();

    this.timeUniformBuffer = device.createBuffer({
      label: "Time uniform buffer",
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.moveLightsComputeBindGroupLayout = device.createBindGroupLayout({
      label: "Move lights compute bind group layout",
      entries: [
        {
          // lightSet
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          // time
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.moveLightsComputeBindGroup = device.createBindGroup({
      label: "Move lights compute bind group",
      layout: this.moveLightsComputeBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.lightSetStorageBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.timeUniformBuffer },
        },
      ],
    });

    this.moveLightsComputePipeline = device.createComputePipeline({
      label: "Move lights compute pipeline",
      layout: device.createPipelineLayout({
        label: "Move lights compute pipeline layout",
        bindGroupLayouts: [this.moveLightsComputeBindGroupLayout],
      }),
      compute: {
        module: device.createShaderModule({
          label: "Move lights compute shader",
          code: moveLightsComputeSrc,
        }),
        entryPoint: "main",
      },
    });

    // TODO-2: initialize layouts, pipelines, textures, etc. needed for light clustering here
    this.maxDepth = Camera.farPlane;

    if (this.maxDepth <= Camera.nearPlane) {
      throw Error("Max depth cannot be <= Camera.nearPlane");
    }

    this.dimensionsUniformBuffer = device.createBuffer({
      size: 3 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const dimensions = new Uint32Array([canvas.width, canvas.height, this.maxDepth]);
    device.queue.writeBuffer(this.dimensionsUniformBuffer, 0, dimensions);

    console.log(`Dimensions: X ${dimensions[0]} / Y ${dimensions[1]} / Z ${dimensions[2]}`);
    console.log("Cluster size:", constants.clusterSize);

    this.numWorkgroups = {
      x: Math.ceil(canvas.width / constants.totalClusterSize.x),
      y: Math.ceil(canvas.height / constants.totalClusterSize.y),
      z: Math.ceil((this.maxDepth - Camera.nearPlane) / constants.totalClusterSize.z),
    };

    // Each workgroup also contains a certain number of clusters
    const totalClusters =
      this.numWorkgroups.x *
      constants.clusteringWorkgroupSize.x *
      this.numWorkgroups.y *
      constants.clusteringWorkgroupSize.y *
      this.numWorkgroups.z *
      constants.clusteringWorkgroupSize.z;

    console.log("Total clusters:", totalClusters);

    this.clusterSetStorageBuffer = device.createBuffer({
      label: "Cluster set storage buffer",
      size: 4 + totalClusters * Lights.clusterByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.clusterSetStorageBuffer, 0, new Uint32Array([totalClusters]));

    console.log("Cluster set storage size in bytes:", 4 + totalClusters * Lights.clusterByteSize);

    this.clusteringComputeBindGroupLayout = device.createBindGroupLayout({
      label: "Clustering compute bind group layout",
      entries: [
        {
          // Camera uniforms
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          // Dimensions uniform
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          // Cluster set, compute shader will write to it
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    this.clusteringComputeBindGroup = device.createBindGroup({
      label: "Clustering compute bind group",
      layout: this.clusteringComputeBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.camera.uniformsBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.dimensionsUniformBuffer },
        },
        {
          binding: 2,
          resource: { buffer: this.clusterSetStorageBuffer },
        },
      ],
    });

    this.clusteringComputePipeline = device.createComputePipeline({
      label: "Clustering compute pipeline",
      layout: device.createPipelineLayout({
        label: "Clustering compute pipeline layout",
        bindGroupLayouts: [this.clusteringComputeBindGroupLayout],
      }),
      compute: {
        module: device.createShaderModule({
          label: "clustering.cs.wgsl",
          code: clusteringComputeSrc,
        }),
        entryPoint: "main",
      },
    });
  }

  private populateLightsBuffer() {
    for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
      // light pos is set by compute shader so no need to set it here
      const lightColor = vec3.scale(hueToRgb(Math.random()), Lights.lightIntensity);
      this.lightsArray.set(lightColor, lightIdx * Lights.numFloatsPerLight + 4);
    }

    device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
  }

  updateLightSetUniformNumLights() {
    device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
  }

  doLightClustering(encoder: GPUCommandEncoder) {
    // TODO-2: run the light clustering compute pass(es) here
    // implementing clustering here allows for reusing the code in both Forward+ and Clustered Deferred
    const computePass = encoder.beginComputePass({
      label: "Light clustering compute pass",
    });

    // Currently, the canvas width and height never changes, even during window resize.
    // So doing this work is a little pointless. But it will come in handy if we ever
    // implement canvas resizing when the browser window size changes!
    const dimensions = new Uint32Array([canvas.width, canvas.height, this.maxDepth]);
    device.queue.writeBuffer(this.dimensionsUniformBuffer, 0, dimensions);

    computePass.setPipeline(this.clusteringComputePipeline);
    computePass.setBindGroup(0, this.clusteringComputeBindGroup);

    console.log(`Stats:
- Dimensions: X ${dimensions[0]} / Y ${dimensions[1]} / Z ${dimensions[2]}
- Cluster size: X ${constants.clusterSize.x} / Y ${constants.clusterSize.y} / Z ${constants.clusterSize.z}
- Workgroup size: X ${constants.clusteringWorkgroupSize.x} / Y ${constants.clusteringWorkgroupSize.y} / Z ${constants.clusteringWorkgroupSize.z}
- Total cluster size: X ${constants.totalClusterSize.x} / Y ${constants.totalClusterSize.y} / Z ${constants.totalClusterSize.z}
- Number of workgroups dispatched: X ${this.numWorkgroups.x} / Y ${this.numWorkgroups.y} / Z ${this.numWorkgroups.z}`);

    computePass.dispatchWorkgroups(
      this.numWorkgroups.x,
      this.numWorkgroups.y,
      this.numWorkgroups.z
    );
    computePass.end();
  }

  // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
  onFrame(time: number) {
    device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

    // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.moveLightsComputePipeline);

    computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

    const workgroupCount = Math.ceil(this.numLights / constants.moveLightsWorkgroupSize);
    computePass.dispatchWorkgroups(workgroupCount);

    computePass.end();

    device.queue.submit([encoder.finish()]);
  }
}
