// TODO-2: implement the light clustering compute shader

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> dimensions: vec3u;

@group(0) @binding(2) var<storage, read_write> clusterSet: ClusterSet;
@group(0) @binding(3) var<storage, read> lightSet: LightSet;

// Normal of the far/near plane is simply the z-axis
const normal = vec3f(0.f, 0.f, 1.f);
const clusterSize = vec3u(${clusterSize.x}, ${clusterSize.y}, ${clusterSize.z});
const threadsPerWorkgroup = ${clusteringWorkgroupSize.x} * ${clusteringWorkgroupSize.y} * ${clusteringWorkgroupSize.z};

fn screenToView(screen: vec2f) -> vec4f {
    // Convert from screen space to clip space
    let clip = vec4f(
        screen.xy / vec2f(dimensions.xy) * 2.f - 1.f,
        0.1f, // This is equal to Camera.nearPlane
        1.f
    );

    // Convert from clip space to view space
    let inv = camera.inverseProjection;
    var view = (inv[0] * clip.x) + (inv[1] * clip.y) + (inv[2] * clip.z) + (inv[3] * clip.w);

    // Undo hardware perspective divide
    view = view / view.w;

    return view;
}

fn linePlaneIsect(a: vec3f, b: vec3f, z: f32) -> vec3f {
    let aToB = b - a;
    let t = (z - dot(normal, a)) / dot(normal, aToB);

    return a + (t * aToB);
}

// Assumes the sphere center is in view (camera) space.
// Adapted from https://stackoverflow.com/questions/28343716/sphere-intersection-test-of-aabb
fn sphereAabbIsect(center: vec3f, radius: f32, min: vec3f, max: vec3f) -> bool {
    var sum = 0.f;

    for (var dir = 0u; dir < 3u; dir++) {
        let val : f32 = center[dir];

        if (val < min[dir]) {
            sum += (min[dir] - val) * (min[dir] - val);
        }

        if (val > max[dir]) {
            sum += (val - max[dir]) * (val - max[dir]);
        }
    }

    return sum <= (radius * radius);
}

@compute
@workgroup_size(
    ${clusteringWorkgroupSize.x},
    ${clusteringWorkgroupSize.y},
    ${clusteringWorkgroupSize.z}
)
fn main(
    @builtin(workgroup_id) workgroup_id : vec3u,
    @builtin(global_invocation_id) offset: vec3u,
    @builtin(num_workgroups) num_workgroups: vec3u,
    @builtin(local_invocation_index) local_invocation_index: u32
) {
    let width = dimensions.x;
    let height = dimensions.y;
    let depth = dimensions.z;

    let minScreen = offset * clusterSize;

    // if (minScreen.x >= width || minScreen.y >= height || minScreen.z > depth) {
    //     clusterSet.clusters[globalInvocationIndex].numLights = 99999;
    //     return;
    // }

    let maxScreen = (offset + vec3u(1)) * clusterSize;
    
    let minView : vec3f = screenToView(vec2f(minScreen.xy)).xyz;
    let maxView : vec3f = screenToView(vec2f(maxScreen.xy)).xyz;

    // The near and far planes for this particular cluster i.e. not the camera.
    // Note that all the cluster near planes are offset by Camera.nearPlane, and the
    // maximum far plane distance is still dictated by dimensions.z.
    let viewNear = f32(minScreen.z) + 0.1f;
    let viewFar = min(f32(maxScreen.z), f32(depth));

    let totalSlices = f32(num_workgroups.z * ${clusteringWorkgroupSize.z});
    let ratio = viewFar / viewNear;
    let clusterNear = -viewNear * pow(ratio, f32(offset.z) / totalSlices);
    let clusterFar = -viewNear * pow(ratio, f32(offset.z + 1) / totalSlices);

    // Since we've manipulated our Z values, they don't perfectly match up with our
    // pre-defined Z cluster size anymore, so we have to perform ray-plane intersections
    // to find min/max bounding coordinates
    let minPointNear = linePlaneIsect(vec3f(), minView, clusterNear);
    let minPointFar = linePlaneIsect(vec3f(), minView, clusterFar);
    let maxPointNear = linePlaneIsect(vec3f(), maxView, clusterNear);
    let maxPointFar = linePlaneIsect(vec3f(), maxView, clusterFar);

    let min : vec3f = min(min(minPointNear, minPointFar), min(maxPointNear, maxPointFar));
    let max : vec3f = max(max(minPointNear, minPointFar), max(maxPointNear, maxPointFar));

    // Calculate global index
    let workgroupIndex = 
        workgroup_id.x +
        workgroup_id.y * num_workgroups.x +
        workgroup_id.z * num_workgroups.x * num_workgroups.y;
    let globalInvocationIndex = workgroupIndex * threadsPerWorkgroup + local_invocation_index;

    // Keep track of how many lights this cluster stores. Stop early
    // if we reach the maximum amount
    var clusterLightCount = 0u;

    // For every light, check if its volume intersects with this cluster's AABB
    for (var lightIndex = 0u; lightIndex < lightSet.numLights; lightIndex++) {
        let center = lightSet.lights[lightIndex].pos;
        let viewCenter = camera.view * vec4f(center, 1.f);

        if (sphereAabbIsect(viewCenter.xyz, ${lightRadius}, min, max)) {
            clusterSet.clusters[globalInvocationIndex].lights[clusterLightCount] = lightIndex;
            clusterLightCount++;

            if (clusterLightCount == ${maxLightsInCluster}) {
                break;
            }
        }
    }

    clusterSet.clusters[globalInvocationIndex].numLights = clusterLightCount;
}
