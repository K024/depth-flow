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
uniform vec2 camera_size;

uniform sampler2D image;
uniform sampler2D depth_map;
uniform sampler2D blur_mipmap;

uniform int forward_steps;
uniform int backward_steps;
uniform float edge_blur_threshold;

// common constants

const vec3 up = vec3(0.f, 1.f, 0.f);
const vec3 plane_norm = vec3(0.f, 0.f, 1.f);
const vec3 near_plane_center = vec3(0.f, 0.f, -1.1f);
const vec3 far_plane_center = vec3(0.f, 0.f, 1.1f);

// helper functions

float position_depth(vec3 pos) {
  vec2 tex_coord = pos.xy * 0.5f + 0.5f;
  vec4 sampl = texture(depth_map, tex_coord);
  return -(sampl.r * 2.f - 1.f); // 0 ~ 1 to 1 ~ -1
}

float sdf_rect(vec2 position, vec2 half_size, float corner_radius) {
  vec2 dxy = abs(position) - half_size + corner_radius;
  return length(max(dxy, 0.0f)) + min(max(dxy.x, dxy.y), 0.0f) - corner_radius;
}

vec4 position_color(vec3 pos) {
  vec2 tex_coord = pos.xy * 0.5f + 0.5f;
  vec4 sampl = texture(image, tex_coord);
  float edge_distance = sdf_rect(pos.xy, vec2(1.f), edge_blur_threshold);
  vec4 blur_sampl = texture(blur_mipmap, pos.xy * (1.f - edge_blur_threshold * 3.f) * .5f + .5f);
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
  ray_position = near_point;
  float forward_step_size = 1.f / float(forward_steps);
  float backward_step_size = forward_step_size / float(backward_steps);
  vec3 forward_step = (far_point - near_point) * forward_step_size;
  vec3 backward_step = (near_point - far_point) * backward_step_size;

  // forward iterations
  for(int it = 0; it <= forward_steps; it += 1) {
    ray_position += forward_step;
    float depth = position_depth(ray_position);
    if(ray_position.z > depth) { // we reached the depth boundary
      break;
    }
  }

  // backward iterations
  for(int it = 0; it <= backward_steps; it += 1) {
    ray_position += backward_step;
    float depth = position_depth(ray_position);
    if(ray_position.z < depth) { // a small step out of boundary
      break;
    }
  }

  current_color = position_color(ray_position);
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
