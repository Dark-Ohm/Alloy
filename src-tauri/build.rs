use std::fs;
use std::path::Path;

fn main() {
    // Generate a simple but valid PNG icon
    let icons_dir = Path::new("icons");
    fs::create_dir_all(icons_dir).ok();

    for (size, name) in &[
        (512, "icon.png"),
        (256, "128x128@2x.png"),
        (128, "128x128.png"),
        (32, "32x32.png"),
    ] {
        let path = icons_dir.join(name);
        if !path.exists() {
            if let Some(data) = generate_png(*size, *size) {
                fs::write(&path, data).ok();
            }
        }
    }

    tauri_build::build()
}

/// Generate a minimal valid RGBA PNG
fn generate_png(width: u32, height: u32) -> Option<Vec<u8>> {
    use std::io::Write;

    let mut buf = Vec::new();

    // PNG signature
    buf.write_all(b"\x89PNG\r\n\x1a\n").ok()?;

    // IHDR chunk
    let mut ihdr = Vec::new();
    ihdr.write_all(&width.to_be_bytes()).ok()?;
    ihdr.write_all(&height.to_be_bytes()).ok()?;
    ihdr.push(8); // bit depth
    ihdr.push(6); // color type: RGBA
    ihdr.push(0); // compression
    ihdr.push(0); // filter
    ihdr.push(0); // interlace
    write_chunk(&mut buf, b"IHDR", &ihdr)?;

    // IDAT chunk
    let raw_size = (1 + width * 4) as usize * height as usize;
    let mut raw = Vec::with_capacity(raw_size);
    for _ in 0..height {
        raw.extend(std::iter::repeat_n(0u8, 1));
        for _ in 0..width {
            raw.push(122); // R
            raw.push(162); // G
            raw.push(247); // B
            raw.push(255); // A
        }
    }

    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 9);
    write_chunk(&mut buf, b"IDAT", &compressed)?;

    // IEND chunk
    write_chunk(&mut buf, b"IEND", &[])?;

    Some(buf)
}

fn write_chunk(buf: &mut Vec<u8>, chunk_type: &[u8], data: &[u8]) -> Option<()> {
    use std::io::Write;
    let len = data.len() as u32;
    buf.write_all(&len.to_be_bytes()).ok()?;
    buf.extend_from_slice(chunk_type);
    buf.extend_from_slice(data);
    let mut crc = crc32fast::Hasher::new();
    crc.update(chunk_type);
    crc.update(data);
    buf.write_all(&crc.finalize().to_be_bytes()).ok()?;
    Some(())
}
