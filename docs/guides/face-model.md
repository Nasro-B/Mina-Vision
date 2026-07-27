> 🇬🇧 **English** · [🇫🇷 Français](face-model.fr.md)

# Local face recognition — provisioning a model

Mina's face recognition is **local** (no image ever leaves for the Internet) and **optional**.
As long as no model is provisioned, the `biometrics.face` capability stays honestly
"unavailable" and **no recognition can ever return a false positive** (fail-closed).

## Why you provide the model yourself

This is a **security** capability. An unsuitable model or wrong preprocessing would make facial
authentication dangerous. So Mina does **not** download a random model: you pick an ONNX face
embedding model you have validated (e.g. **ArcFace** or **MobileFaceNet**, widely available in
ONNX format), and you declare its exact parameters. The script verifies everything before
enabling it.

## Steps

1. Get a face embedding model in `.onnx` format (usually 112×112 input, 512-D output).
2. Find the EXACT names of its input/output tensors (with Netron, or `onnxruntime`).
3. Run the provisioning (you run it yourself — the script reads/copies a local file):

```bash
node scripts/provision-face-model.mjs --model=path/to/arcface.onnx --input=input.1 --output=683 --width=112 --height=112 --mean=0.5,0.5,0.5 --std=0.5,0.5,0.5 --layout=nchw
```

The script:
- copies the model under `%APPDATA%\Mina Vision\cache\models\face\`,
- computes its `sha256`,
- **actually loads** the model (verifies checksum + tensor signatures),
- **runs a test embedding** on a neutral image (fails if the output is absurd),
- writes `manifest.json` only if everything passes.

4. Restart Mina. The `biometrics.face` capability turns "available".

## Parameters

| Option | Role |
|--------|------|
| `--input` / `--output` | exact ONNX tensor names (must match the model, otherwise refused) |
| `--width` / `--height` | model input size (default 112×112) |
| `--mean` / `--std` | per-RGB-channel normalization (default 0.5,0.5,0.5 — range [-1,1]) |
| `--layout` | `nchw` (default, [1,3,H,W]) or `nhwc` ([1,H,W,3]) |

If the tensor names or the normalization do not match the model, the script **refuses** to
write the manifest — never a half-configured biometric.

## Security

- The model is `sha256`-verified at every runtime load: a tampered file is refused.
- Enrolled face profiles are encrypted in the vault (like the memory).
- Embedding happens entirely on the PC (onnxruntime CPU): no image, no facial template ever
  leaves the machine.
