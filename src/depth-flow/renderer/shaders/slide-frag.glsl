#version 300 es
precision highp float;

// input & output

in vec2 position; // [-1, -1] to [1, 1]

out vec4 outColor;

// uniforms

uniform vec3 camera_position; // near [0, 0, -h] looking down the z-axis
uniform vec3 camera_target_center; // near [0, 0, 1]
uniform vec2 camera_zoom_scale; // [1, 1]

uniform vec2 image_size;

uniform sampler2D top_image;
uniform sampler2D bottom_image;
uniform sampler2D layer_map; // r: top depth, g: top alpha, b: bottom depth
uniform sampler2D top_blur_mipmap;
uniform sampler2D bottom_blur_mipmap;
uniform sampler2D depth_bounds;
uniform float depth_bounds_max_lod;

uniform int forward_steps;
uniform int backward_steps;
uniform float edge_blur_threshold;

// common constants

const vec3 up = vec3(0.f, 1.f, 0.f);
const vec3 plane_norm = vec3(0.f, 0.f, 1.f);
const vec3 near_plane_center = vec3(0.f, 0.f, -1.1f);
const vec3 far_plane_center = vec3(0.f, 0.f, 1.1f);

// helper functions

vec2 position_uv(vec3 pos) {
  return pos.xy * 0.5f + 0.5f;
}

float top_position_depth(vec3 pos) {
  vec4 sampl = texture(layer_map, position_uv(pos));
  return 1.f - sampl.r * 2.f; // 0 ~ 1 to 1 ~ -1
}

float bottom_position_depth(vec3 pos) {
  vec4 sampl = texture(layer_map, position_uv(pos));
  return 1.f - sampl.b * 2.f; // 0 ~ 1 to 1 ~ -1
}

vec2 ray_depth_bounds(vec3 near_point, vec3 far_point) {
  vec2 near_uv = clamp(position_uv(near_point), vec2(0.f), vec2(1.f));
  vec2 far_uv = clamp(position_uv(far_point), vec2(0.f), vec2(1.f));
  vec2 uv_min = min(near_uv, far_uv);
  vec2 uv_max = max(near_uv, far_uv);
  vec2 uv_mid = (uv_min + uv_max) * 0.5f;

  vec2 span_texels = (uv_max - uv_min) * image_size;
  float max_half_span_texels = max(span_texels.x, span_texels.y) * 0.5f;
  float selected_lod = clamp(
    ceil(log2(max(max_half_span_texels, 1.f))),
    0.f,
    depth_bounds_max_lod
  );

  vec2 bounds = textureLod(depth_bounds, uv_mid, selected_lod).rg;

  // Bounds include both layers. Texture depth 1 is world Z -1 (near).
  return vec2(1.f - 2.f * bounds.g, 1.f - 2.f * bounds.r);
}

float sdf_rect(vec2 position, vec2 half_size, float corner_radius) {
  vec2 dxy = abs(position) - half_size + corner_radius;
  return length(max(dxy, 0.f)) + min(max(dxy.x, dxy.y), 0.f) - corner_radius;
}

vec4 top_position_color(vec3 pos) {
  vec2 tex_coord = position_uv(pos);
  vec4 sampl = texture(top_image, tex_coord);
  float edge_distance = sdf_rect(pos.xy, vec2(1.f), edge_blur_threshold);
  vec4 blur_sampl = texture(
    top_blur_mipmap,
    pos.xy * (1.f - edge_blur_threshold * 3.f) * 0.5f + 0.5f
  );
  sampl = mix(sampl, blur_sampl, smoothstep(-edge_blur_threshold, 0.f, edge_distance));
  return sampl;
}

vec4 bottom_position_color(vec3 pos) {
  vec2 tex_coord = position_uv(pos);
  vec4 sampl = texture(bottom_image, tex_coord);
  float edge_distance = sdf_rect(pos.xy, vec2(1.f), edge_blur_threshold);
  vec4 blur_sampl = texture(
    bottom_blur_mipmap,
    pos.xy * (1.f - edge_blur_threshold * 3.f) * 0.5f + 0.5f
  );
  sampl = mix(sampl, blur_sampl, smoothstep(-edge_blur_threshold, 0.f, edge_distance));
  return sampl;
}

vec3 ray_plane_intersect(vec3 ray_origin, vec3 ray_direction, vec3 plane_origin, vec3 plane_normal) {
  float denom = dot(plane_normal, ray_direction);
  if(abs(denom) > 1e-6f) {
    float t = dot(plane_origin - ray_origin, plane_normal) / denom;
    if(t >= 0.f) {
      return ray_origin + t * ray_direction;
    }
  }
  return ray_origin; // fallback
}

// ray marching

void ray_marching(vec3 near_point, vec3 far_point, out vec4 current_color, out vec3 ray_position) {
  float forward_step_size = 1.f / float(forward_steps);
  float backward_step_size = forward_step_size / float(backward_steps);
  vec3 forward_step = (far_point - near_point) * forward_step_size;
  vec3 backward_step = (near_point - far_point) * backward_step_size;

  vec2 surface_bounds = ray_depth_bounds(near_point, far_point);
  float z_margin = abs(forward_step.z) * 1.5f;
  float search_near_z = max(near_point.z, surface_bounds.x - z_margin);
  float search_far_z = min(far_point.z, surface_bounds.y + z_margin);
  float inverse_ray_z_span = 1.f / (far_point.z - near_point.z);
  float search_start = clamp(
    (search_near_z - near_point.z) * inverse_ray_z_span,
    0.f,
    1.f
  );
  vec3 search_start_position = mix(near_point, far_point, search_start);
  float search_z_span = max(0.f, search_far_z - search_start_position.z);
  int search_steps = min(
    forward_steps + 1,
    int(floor(search_z_span / abs(forward_step.z))) + 1
  );
  ray_position = search_start_position - forward_step;

  // top forward iterations
  for(int it = 0; it < search_steps; it += 1) {
    ray_position += forward_step;
    float depth = top_position_depth(ray_position);
    if(ray_position.z > depth) {
      break;
    }
  }

  // top backward iterations
  for(int it = 0; it <= backward_steps; it += 1) {
    ray_position += backward_step;
    float depth = top_position_depth(ray_position);
    if(ray_position.z < depth) {
      break;
    }
  }

  vec4 top_color = top_position_color(ray_position);
  float top_visibility = texture(layer_map, position_uv(ray_position)).g;
  float top_alpha = top_color.a * top_visibility;

  // Most pixels are opaque; avoid second ray search away from depth edges.
  if (top_alpha >= 1.f - 0.5f / 255.f) {
    current_color = top_color;
    return;
  }

  // Rewind before Top so equal Top/Bottom depths can still cross and hit Bottom.
  ray_position -= forward_step;

  // bottom forward iterations
  for(int it = 0; it < search_steps; it += 1) {
    ray_position += forward_step;
    float depth = bottom_position_depth(ray_position);
    if(ray_position.z > depth) {
      break;
    }
  }

  // bottom backward iterations
  for(int it = 0; it <= backward_steps; it += 1) {
    ray_position += backward_step;
    float depth = bottom_position_depth(ray_position);
    if(ray_position.z < depth) {
      break;
    }
  }

  vec4 bottom_color = bottom_position_color(ray_position);
  current_color = mix(bottom_color, top_color, top_alpha);
}

void main() {
  // ray calculation
  vec3 camera_front = normalize(camera_target_center - camera_position);
  vec3 camera_right = cross(up, camera_front);
  vec3 camera_up = cross(camera_front, camera_right);

  vec3 ray_target = camera_target_center +
    (position.x * camera_zoom_scale.x * camera_right) +
    (position.y * camera_zoom_scale.y * camera_up);

  vec3 ray_direction = normalize(ray_target - camera_position);
  vec3 near_point = ray_plane_intersect(camera_position, ray_direction, near_plane_center, plane_norm);
  vec3 far_point = ray_plane_intersect(camera_position, ray_direction, far_plane_center, plane_norm);

  // ray marching
  vec4 current_color;
  vec3 ray_position;
  ray_marching(near_point, far_point, current_color, ray_position);

  // output
  current_color.a = 1.f;
  outColor = current_color;
  // gl_FragDepth = clamp(ray_position.z, -1.f, 1.f);
}
