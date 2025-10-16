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

fn linePlaneIsect(a: vec3f, b: vec3f, z: f32) -> vec3f {
    // Normal of the far/near plane is simply the z-axis
    let normal = vec3f(0.f, 0.f, 1.f);

    let aToB = b - a;
    let t = (z - dot(normal, a)) / dot(normal, aToB);

    return a + (t * aToB);
}

@compute
@workgroup_size(
    ${clusteringWorkgroupSize.x},
    ${clusteringWorkgroupSize.y},
    ${clusteringWorkgroupSize.z}
)
fn main(
    @builtin(global_invocation_id) offset: vec3u,
    @builtin(num_workgroups) num_workgroups: vec3u
) {
    let width = dimensions.x;
    let height = dimensions.y;
    let depth = dimensions.z;

    let minScreen = offset * clusterSize;

    if (minScreen.x >= width || minScreen.y >= height || minScreen.z > depth) {
        return;
    }

    let maxScreen = (offset + vec3u(1)) * clusterSize;
    
    let minView : vec3f = screenToView(vec2f(minScreen.xy)).xyz;
    let maxView : vec3f = screenToView(vec2f(maxScreen.xy)).xyz;

    // The near and far planes for this particular cluster i.e. not the camera
    let viewNear = f32(minScreen.z);
    let viewFar = f32(maxScreen.z);

    let clusterNear = -viewNear * pow(viewFar / viewNear, f32(offset.z) / f32(num_workgroups.z * ${clusteringWorkgroupSize.z}));
    let clusterFar = -viewNear * pow(viewFar / viewNear, f32(offset.z + 1) / f32(num_workgroups.z * ${clusteringWorkgroupSize.z}));

    // Since we've manipulated our Z values, they don't perfectly match up with our
    // pre-defined Z cluster size anymore, so we have to perform ray-plane intersections
    // to find min/max bounding coordinates
    let minPointNear = linePlaneIsect(vec3f(), minView, clusterNear);
    let minPointFar = linePlaneIsect(vec3f(), minView, clusterFar);
    let maxPointNear = linePlaneIsect(vec3f(), maxView, clusterNear);
    let maxPointFar = linePlaneIsect(vec3f(), maxView, clusterFar);

    let min = min(min(minPointNear, minPointFar), min(maxPointNear, maxPointFar));
    let max = max(max(minPointNear, minPointFar), max(maxPointNear, maxPointFar));
}
