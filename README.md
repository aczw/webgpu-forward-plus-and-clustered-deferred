> [!NOTE]
> Please visit [charleszw.com/projects/webgpu-clustered](https://charleszw.com/projects/webgpu-clustered) for the most up to date version of this project write-up! It's been significantly edited and expanded with more implementation details and performance benchmarks :)

**University of Pennsylvania, CIS 5650: GPU Programming and Architecture, Project 4**

- Charles Wang
  - [LinkedIn](https://linkedin.com/in/zwcharl)
  - [Personal website](https://charleszw.com)
- Tested on:
  - Windows 11 Pro (26100.4946)
  - Ryzen 5 7600X @ 4.7Ghz
  - 32 GB RAM
  - RTX 5060 Ti 16 GB (Studio Driver 581.29)

# WebGPU Forward+ and Clustered Deferred Shading

![](images/sponza_bright.png)

_Sponza scene, 3024×1704 resolution, 5000 lights_

## Demo

[Live demo link here!](https://aczw.github.io/webgpu-forward-plus-and-clustered-deferred) Here's a recorded video taken on my M4 MacBook Pro.

https://github.com/user-attachments/assets/54f36dd2-abfc-4259-a88c-6be94e762a65

## Overview

This project aims to demonstrate forward+ rendering, clustered deferred rendering, and compare both of these methods against a naive method. Everything is implemented with WebGPU and this was a great opportunity to learn and become familiar with the API.

Below I will discuss some details on how each rendering method was implemented, and perform some performance benchmarks to see how well I did for each!

### Implementations

The base setup is the same across all three implementations. We are initially looking down our Sponza scene, and have a certain number of lights to render.

![](images/sponza_albedo.png)

_Sponza scene, rendered only with the base albedo colors._

Every frame, the lights randomly move across the scene, meaning they're dynamic. They're also all different colors; the point is, we can't make any assumptions about the lights themselves. In our shaders, we only have a light's position and color information.

#### Naive

There's not many interesting things to say about the naive implementation. We perform light calculations in the fragment shader, and iterate over the entire light list to sum up the total light contribution, multiplying that by the base diffuse color.

There's many optimization opportunities here. In the next two implementations, we'll try to address the following two problems:

1. Consider the world position associated with a fragment. Since the lights are all spread out across the scene, we are wasting resources on calculating the light contribution for lights that are too far away to have any impact.
2. In the graphics pipeline, by default the depth test is performed _after_ processing all fragments. This means we waste a lot of time on light computation for fragments that will be discarded in the end anyway.

### Forward+

Forward+ attempts to address the first problem by performing _clustered_ rendering. The idea is that we split the scene into _clusters_, which are view space bounding boxes. Then, before performing the render pass, we perform an additional compute pass that assigns lights to clusters.

In the fragment shader, we then only consider lights present in the cluster associated with the fragment, which is determined by its view space position.

### Clustered deferred

Building on forward+, we introduce _deferred_ rendering in between the compute pass and final render pass. Before performing light calculations, we first render the scene to textures, storing information such as world position, normals, and scene albedo.

Performing this render pass inherently runs depth tests, meaning we only calculate lighting contributions for each final pixel once. This solves our second problem mentioned earlier.

### Performance benchmarks

To keep things consistent, I maintained the same canvas resolution of 1920×1200.

![](images/graph.png)

## Credits

- [Vite](https://vitejs.dev/)
- [loaders.gl](https://loaders.gl/)
- [dat.GUI](https://github.com/dataarts/dat.gui)
- [stats.js](https://github.com/mrdoob/stats.js)
- [wgpu-matrix](https://github.com/greggman/wgpu-matrix)
