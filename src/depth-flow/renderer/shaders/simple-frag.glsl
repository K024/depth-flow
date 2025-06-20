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
uniform sampler2D image;
uniform sampler2D depth_map;

uniform int forward_steps;
uniform int backward_steps;

// common constants

const vec3 up = vec3(0.f, 1.f, 0.f);
const vec3 plane_norm = vec3(0.f, 0.f, 1.f);
const vec3 near_plane_center = vec3(0.f, 0.f, -1.1f);
const vec3 far_plane_center = vec3(0.f, 0.f, 1.1f);

// helper functions

float position_depth(sampler2D depth_map, vec3 pos) {
  vec2 tex_coord = pos.xy * 0.5f + 0.5f;
  vec4 sampl = texture(depth_map, tex_coord);
  return -(sampl.r * 2.f - 1.f); // 0 ~ 1 to 1 ~ -1
}

vec4 position_color(sampler2D image, vec3 pos) {
  vec2 tex_coord = pos.xy * 0.5f + 0.5f;
  vec4 sampl = texture(image, tex_coord);
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

vec3 ray_marching_backward(vec3 near_point, vec3 far_point, float backward_step_size, sampler2D depth_map, float walk) {
  for(int it = 0; it <= backward_steps; it += 1) {
    walk -= backward_step_size;
    vec3 pos = mix(near_point, far_point, walk);
    float depth = position_depth(depth_map, pos);
    if(pos.z < depth) { // a small step out of boundary
      break;
    }
  }
  return mix(near_point, far_point, walk);
}

void ray_marching(vec3 near_point, vec3 far_point, out vec4 final_color, out vec3 final_pos) {
  float walk = 0.f;
  float forward_step_size = 1.f / float(forward_steps);
  float backward_step_size = forward_step_size / float(backward_steps);

  vec4 current_color = vec4(0.f, 0.f, 0.f, 0.f);

  // forward iterations
  for(int it = 0; it <= forward_steps; it += 1) {
    walk += forward_step_size;
    vec3 pos = mix(near_point, far_point, walk);
    float depth = position_depth(depth_map, pos);
    bool is_in_depth = pos.z > depth;
    if(is_in_depth) { // we reached the depth boundary
      vec3 pos = ray_marching_backward(near_point, far_point, backward_step_size, depth_map, walk);
      vec4 color = position_color(image, pos);
      current_color = color;
      break;
    }
  }

  final_pos = mix(near_point, far_point, walk);
  final_color = current_color;
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
  vec4 final_color;
  vec3 final_pos;
  ray_marching(near_point, far_point, final_color, final_pos);

  // output
  outColor = final_color;
}
