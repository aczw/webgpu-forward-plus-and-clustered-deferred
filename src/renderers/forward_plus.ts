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
  depthPipeline: GPURenderPipeline;
  bglForDepth: GPUBindGroupLayout;
  bgForDepth: GPUBindGroup;
  depthPassDepthTexture: GPUTexture;
  depthPassDepthTextureView: GPUTextureView;

  renderPipeline: GPURenderPipeline;
  bglForRender: GPUBindGroupLayout;
  bgForRender: GPUBindGroup;
  renderPassDepthTexture: GPUTexture;

  constructor(stage: Stage) {
    super(stage);

    this.depthPassDepthTexture = device.createTexture({
      label: "[F+] Depth pass depth texture",
      size: [canvas.width, canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Will be written to during depth pass, and read from during render pass
    this.depthPassDepthTextureView = this.depthPassDepthTexture.createView();

    this.bglForDepth = device.createBindGroupLayout({
      label: "[F+] Bind group layout for depth pipeline",
      entries: [
        {
          // Camera uniforms
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.bgForDepth = device.createBindGroup({
      label: "[F+] Bind group for depth pipeline",
      layout: this.bglForDepth,
      entries: [{ binding: 0, resource: { buffer: this.camera.uniformsBuffer } }],
    });

    this.depthPipeline = device.createRenderPipeline({
      label: "[F+] Depth pipeline",
      layout: device.createPipelineLayout({
        label: "[F+] Depth pipeline layout",
        bindGroupLayouts: [this.bglForDepth, modelBindGroupLayout, materialBindGroupLayout],
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
    });

    // Will not be read from, only written to for depth test
    this.renderPassDepthTexture = device.createTexture({
      label: "[F+] Render pass depth texture",
      size: [canvas.width, canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.bglForRender = device.createBindGroupLayout({
      label: "[F+] Bind group layout for render pipeline",
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
        {
          // Cluster set
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          // Dimensions uniform
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          // Depth texture
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          // Depth sampler
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "non-filtering" },
        },
      ],
    });

    this.bgForRender = device.createBindGroup({
      label: "[F+] Bind group for render pipeline",
      layout: this.bglForRender,
      entries: [
        { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
        { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
        { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } },
        { binding: 3, resource: { buffer: this.lights.dimensionsUniformBuffer } },
        { binding: 4, resource: this.depthPassDepthTextureView },
        {
          binding: 5,
          resource: device.createSampler({
            label: "[F+] Depth texture sampler",
          }),
        },
      ],
    });

    this.renderPipeline = device.createRenderPipeline({
      label: "[F+] Render pipeline",
      layout: device.createPipelineLayout({
        label: "[F+] Render pipeline layout",
        bindGroupLayouts: [this.bglForRender, modelBindGroupLayout, materialBindGroupLayout],
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
    const encoder = device.createCommandEncoder({
      label: "[F+] Command encoder",
    });

    this.lights.doLightClustering(encoder);

    {
      const depthPass = encoder.beginRenderPass({
        label: "[F+] Depth pass",
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.depthPassDepthTextureView,
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      depthPass.setPipeline(this.depthPipeline);
      depthPass.setBindGroup(constants.bindGroup_scene, this.bgForDepth);

      this.scene.iterate(
        (node) => depthPass.setBindGroup(constants.bindGroup_model, node.modelBindGroup),
        (material) =>
          depthPass.setBindGroup(constants.bindGroup_material, material.materialBindGroup),
        (primitive) => {
          depthPass.setVertexBuffer(0, primitive.vertexBuffer);
          depthPass.setIndexBuffer(primitive.indexBuffer, "uint32");
          depthPass.drawIndexed(primitive.numIndices);
        }
      );

      depthPass.end();
    }

    {
      const renderPass = encoder.beginRenderPass({
        label: "[F+] Render pass",
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: [0, 0, 0, 0],
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: this.renderPassDepthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
          //   depthReadOnly: true,
        },
      });

      renderPass.setPipeline(this.renderPipeline);
      renderPass.setBindGroup(constants.bindGroup_scene, this.bgForRender);

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
    }

    device.queue.submit([encoder.finish()]);
  }
}
