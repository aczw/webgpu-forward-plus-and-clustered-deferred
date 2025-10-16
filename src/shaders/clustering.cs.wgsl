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

const clusterSize = vec3u(${clusterSize.x}, ${clusterSize.y}, ${clusterSize.z});

fn screenToView(screen: vec2f) -> vec4f {
    // Convert from screen space to clip space
    let clip = vec4f(
        screen.x / f32(dimensions.x) * 2.f - 1.f,
        1.f - (screen.y / f32(dimensions.y) * 2.f),
        0.f,
        1.f
    );

    // Convert from clip space to view space
    var view = camera.inverseProjection * clip;

    // Undo hardware perspective divide
    view = view / view.w;

    return view;
}

@compute
@workgroup_size(
    ${clusteringWorkgroupSize.x},
    ${clusteringWorkgroupSize.y},
    ${clusteringWorkgroupSize.z}
)
fn main(@builtin(global_invocation_id) offset: vec3u) {
    let width = dimensions.x;
    let height = dimensions.y;
    let depth = dimensions.z;

    let minScreen = offset * clusterSize;

    if (minScreen.x >= width || minScreen.y >= height || minScreen.z > depth) {
        return;
    }

    let maxScreen = (offset + vec3u(1)) * clusterSize;
    
    let minView = screenToView(vec2f(minScreen.xy));
    let maxView = screenToView(vec2f(maxScreen.xy));
}
