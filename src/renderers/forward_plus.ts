import {
  Renderer,
  device,
  modelBindGroupLayout,
  materialBindGroupLayout,
  vertexBufferLayout,
  canvasFormat,
  context,
  canvas,
} from "../renderer";
import { naiveVertSrc, forwardPlusFragSrc, constants } from "../shaders/shaders";
import { Stage } from "../stage/stage";

export class ForwardPlusRenderer extends Renderer {
  sceneUniformsBindGroupLayout: GPUBindGroupLayout;
  sceneUniformsBindGroup: GPUBindGroup;

  depthTexture: GPUTexture;
  depthTextureView: GPUTextureView;

  pipeline: GPURenderPipeline;

  constructor(stage: Stage) {
    super(stage);

    // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here
    this.sceneUniformsBindGroupLayout = device.createBindGroupLayout({
      label: "[F+] Scene uniforms bind group layout",
      entries: [
        {
          // Camera uniforms
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
        {
          // Light set
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    this.sceneUniformsBindGroup = device.createBindGroup({
      label: "[F+] Scene uniforms bind group",
      layout: this.sceneUniformsBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.camera.uniformsBuffer },
        },
        {
          binding: 1,
          resource: { buffer: this.lights.lightSetStorageBuffer },
        },
      ],
    });

    this.depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTextureView = this.depthTexture.createView();

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        label: "[F+] Pipeline layout",
        bindGroupLayouts: [
          this.sceneUniformsBindGroupLayout,
          modelBindGroupLayout,
          materialBindGroupLayout,
        ],
      }),
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: "less",
        format: "depth24plus",
      },
      vertex: {
        module: device.createShaderModule({
          label: "[F+] Vertex shader, same as naive",
          code: naiveVertSrc,
        }),
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: device.createShaderModule({
          label: "[F+] Fragment shader",
          code: forwardPlusFragSrc,
        }),
        targets: [
          {
            format: canvasFormat,
          },
        ],
      },
    });
  }

  override draw() {
    // TODO-2: run the Forward+ rendering pass:
    // - run the clustering compute shader
    // - run the main rendering pass, using the computed clusters for efficient lighting
    const encoder = device.createCommandEncoder();
    const canvasTextureView = context.getCurrentTexture().createView();

    this.lights.doLightClustering(encoder);

    const renderPass = encoder.beginRenderPass({
      label: "[F+] Render pass",
      colorAttachments: [
        {
          view: canvasTextureView,
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    renderPass.setPipeline(this.pipeline);

    renderPass.setBindGroup(constants.bindGroup_scene, this.sceneUniformsBindGroup);

    this.scene.iterate(
      (node) => renderPass.setBindGroup(constants.bindGroup_model, node.modelBindGroup),
      (material) =>
        renderPass.setBindGroup(constants.bindGroup_material, material.materialBindGroup),
      (primitive) => {
        renderPass.setVertexBuffer(0, primitive.vertexBuffer);
        renderPass.setIndexBuffer(primitive.indexBuffer, "uint32");
        renderPass.drawIndexed(primitive.numIndices);
      }
    );

    renderPass.end();
    device.queue.submit([encoder.finish()]);
  }
}
