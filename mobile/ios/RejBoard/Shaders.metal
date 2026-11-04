#include <metal_stdlib>
using namespace metal;

// Ink compositing: one full-screen triangle; tail (provisional end of the stroke, rings) over wet (the stroke being drawn)
// over dry (paper + board).
// All three textures hold premultiplied BGRA written by Core Graphics.

struct InkVertexOut {
    float4 position [[position]];
    float2 uv;
};

vertex InkVertexOut ink_vertex(uint vid [[vertex_id]]) {
    float2 p = float2((vid << 1) & 2, vid & 2); // (0,0) (2,0) (0,2)
    InkVertexOut o;
    o.position = float4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
    o.uv = p;
    return o;
}

fragment float4 ink_fragment(InkVertexOut in [[stage_in]],
                             texture2d<float> dry [[texture(0)]],
                             texture2d<float> wet [[texture(1)]],
                             texture2d<float> tail [[texture(2)]]) {
    constexpr sampler s(coord::normalized, filter::nearest, address::clamp_to_edge);
    float4 d = dry.sample(s, in.uv);
    float4 w = wet.sample(s, in.uv);
    float4 t = tail.sample(s, in.uv);
    float4 under = w + d * (1.0 - w.a);
    return t + under * (1.0 - t.a);
}
