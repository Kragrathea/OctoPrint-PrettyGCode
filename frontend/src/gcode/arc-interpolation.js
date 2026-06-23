// Copied from Prusa firmware's mc_arc so rendered arcs match what gets printed:
// https://github.com/prusa3d/Prusa-Firmware/blob/74a577bc0e5902767b072ee85f499dc1361bf6ba/Firmware/motion_control.cpp#L29
// which in turn derives from Marlin's plan_arc (e.g. the min_arc_segments handling):
// https://github.com/MarlinFirmware/Marlin/blob/6ec4e744c07f4035312ab4f8d377c9c2d2154d5e/Marlin/src/gcode/motion/G2_G3.cpp
// Local names mirror the C++ source on purpose, hence the snake_case in this file.

const arcParams = {
    mm_per_arc_segment: 1.0,
    min_arc_segments: 20,
    min_mm_per_arc_segment: 0.1,
    n_arc_correction: 24,
};

export function interpolateArc(state, arc, params = arcParams) {
    const initial_position = {};
    const current_position = {};
    Object.assign(initial_position, state);
    Object.assign(current_position, state);
    const interpolated_segments = [initial_position];

    const radius = Math.hypot(arc.i, arc.j);
    const v_radius = {x: -1.0 * arc.i, y: -1.0 * arc.j};
    const center = {x: current_position.x - v_radius.x, y: current_position.y - v_radius.y};
    const travel_z = arc.z - current_position.z;
    const travel_e = arc.e - current_position.e;
    const v_radius_target = {x: arc.x - center.x, y: arc.y - center.y};

    let angular_travel_total = Math.atan2(
        v_radius.x * v_radius_target.y - v_radius.y * v_radius_target.x,
        v_radius.x * v_radius_target.x + v_radius.y * v_radius_target.y,
    );
    if (angular_travel_total < 0) angular_travel_total += 2.0 * Math.PI;

    let mm_per_arc_segment = params.mm_per_arc_segment;
    if (params.min_arc_segments > 0) {
        mm_per_arc_segment = radius * ((2.0 * Math.PI) / params.min_arc_segments);
    }
    if (params.min_mm_per_arc_segment > 0 && mm_per_arc_segment < params.min_mm_per_arc_segment) {
        mm_per_arc_segment = params.min_mm_per_arc_segment;
    }
    if (mm_per_arc_segment > params.mm_per_arc_segment) {
        mm_per_arc_segment = params.mm_per_arc_segment;
    }

    if (arc.is_clockwise) angular_travel_total -= 2.0 * Math.PI;

    // A full circle gives an angle of 0 here; treat it as a whole turn
    if (current_position.x == arc.x && current_position.y == arc.y && angular_travel_total == 0) {
        angular_travel_total += 2.0 * Math.PI;
    }

    const mm_of_travel_arc = Math.hypot(angular_travel_total * radius, Math.abs(travel_z));
    const num_segments = Math.ceil(mm_of_travel_arc / mm_per_arc_segment);

    const xy_segment_theta = angular_travel_total / num_segments;
    const z_segment_theta = travel_z / num_segments;
    const e_segment_theta = travel_e / num_segments;

    if (num_segments > 1) {
        const cos_t = Math.cos(xy_segment_theta);
        const sin_t = Math.sin(xy_segment_theta);
        let count = 0;
        for (let i = 1; i < num_segments; i++) {
            if (count < params.n_arc_correction) {
                const r_axisi = v_radius.x * sin_t + v_radius.y * cos_t;
                v_radius.x = v_radius.x * cos_t - v_radius.y * sin_t;
                v_radius.y = r_axisi;
                count++;
            } else {
                // Exact recompute every n_arc_correction steps to stop sin/cos drift
                const sin_ti = Math.sin(i * xy_segment_theta);
                const cos_ti = Math.cos(i * xy_segment_theta);
                v_radius.x = (-1.0 * arc.i) * cos_ti + arc.j * sin_ti;
                v_radius.y = (-1.0 * arc.i) * sin_ti - arc.j * cos_ti;
                count = 0;
            }

            const line = {
                x: center.x + v_radius.x,
                y: center.y + v_radius.y,
                z: current_position.z + z_segment_theta,
                e: current_position.e + e_segment_theta,
                f: arc.f,
            };
            interpolated_segments.push(line);
            current_position.x = line.x;
            current_position.y = line.y;
            current_position.z = line.z;
            current_position.e = line.e;
        }
    }

    interpolated_segments.push({x: arc.x, y: arc.y, z: arc.z, e: arc.e, f: arc.f});
    return interpolated_segments;
}
