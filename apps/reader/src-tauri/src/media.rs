//! Loopback media server (ADR-0023): Linux WebKitGTK cannot serve media
//! through `asset://`, and video blobs are content-addressed files under the
//! app data directory. A token-gated HTTP server on 127.0.0.1 with Range
//! support lets `<video>` stream without loading the file into memory. The
//! token keeps other local processes from reading the library.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::resolve_beneath;
use tiny_http::{Header, Response, Server};

/// Served extensions and their MIME types. Deliberately video-only: audio
/// books play over object URLs (ADR-0021), documents open in the reader.
const MEDIA_TYPES: &[(&str, &str)] = &[
    ("mp4", "video/mp4"),
    ("m4v", "video/mp4"),
    ("mkv", "video/x-matroska"),
    ("webm", "video/webm"),
];

fn content_type(ext: &str) -> Option<&'static str> {
    MEDIA_TYPES
        .iter()
        .find(|(known, _)| *known == ext)
        .map(|(_, mime)| *mime)
}

pub struct MediaState {
    /// The URL prefix once the server has started; None until then.
    pub base_url: Mutex<Option<String>>,
}

enum Range {
    Full,
    /// Inclusive byte offsets; `end` is None for an open-ended range.
    Slice(u64, Option<u64>),
}

/// Parse a single-range `Range: bytes=...` header. Multi-range requests fall
/// back to serving the whole file (players rarely send them; correctness
/// first).
fn parse_range(header: Option<&str>, size: u64) -> Range {
    let Some(spec) = header else {
        return Range::Full;
    };
    let Some(value) = spec.strip_prefix("bytes=") else {
        return Range::Full;
    };
    if value.contains(',') {
        return Range::Full;
    }
    let (start_part, end_part) = match value.split_once('-') {
        Some(parts) => parts,
        None => return Range::Full,
    };
    if start_part.is_empty() {
        // Suffix form: the last N bytes.
        match end_part.parse::<u64>() {
            Ok(suffix) if suffix > 0 => {
                let clamped = suffix.min(size);
                return Range::Slice(size - clamped, Some(size.saturating_sub(1)));
            }
            _ => return Range::Full,
        }
    }
    let Ok(start) = start_part.parse::<u64>() else {
        return Range::Full;
    };
    if start >= size {
        return Range::Slice(start, None); // Signal 416 below.
    }
    match end_part.parse::<u64>() {
        Ok(end) => Range::Slice(start, Some(end.min(size.saturating_sub(1)))),
        Err(_) => Range::Slice(start, Some(size.saturating_sub(1))),
    }
}

/// Serve one request, or None when the request is not for this server.
fn handle_request(request: tiny_http::Request, token: &str, base_dir: &PathBuf) -> Option<()> {
    let url = request.url().to_string();
    let path = url.split('?').next()?.to_string();
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    // /media/<token>/<sha256>.<ext>
    if parts.len() != 3 || parts[0] != "media" || parts[1] != token {
        let response = Response::from_string("not found").with_status_code(404);
        let _ = request.respond(response);
        return Some(());
    }

    let file_name = parts[2];
    let Some((sha256, ext)) = file_name.split_once('.') else {
        let _ = request.respond(Response::from_string("bad path").with_status_code(404));
        return Some(());
    };
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        let _ = request.respond(Response::from_string("bad path").with_status_code(404));
        return Some(());
    }
    let Some(mime) = content_type(ext) else {
        let _ = request.respond(Response::from_string("unsupported type").with_status_code(404));
        return Some(());
    };

    let path = match resolve_beneath(base_dir, &format!("books/{sha256}")) {
        Ok(path) => path,
        Err(_) => {
            let _ = request.respond(Response::from_string("not found").with_status_code(404));
            return Some(());
        }
    };
    let Ok(file) = File::open(&path) else {
        let _ = request.respond(Response::from_string("not found").with_status_code(404));
        return Some(());
    };
    let size = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(_) => {
            let _ = request.respond(Response::from_string("unreadable").with_status_code(500));
            return Some(());
        }
    };

    let range_header = request
        .headers()
        .iter()
        .find(|header| header.field.equiv(&"Range"))
        .map(|header| header.value.as_str().to_string());
    let range = parse_range(range_header.as_deref(), size);
    let mut file = file;
    // HEAD requests get the same response; tiny_http strips the body itself.
    let (code, extra_headers, body, body_len) = match range {
        Range::Full => (
            200_u16,
            Vec::new(),
            Box::new(file) as Box<dyn Read + Send>,
            size,
        ),
        Range::Slice(start, end) if start < size => {
            let end = end.unwrap_or(size - 1);
            let _ = file.seek(SeekFrom::Start(start));
            let length = end - start + 1;
            let content_range = format!("bytes {start}-{end}/{size}");
            let extra_headers = vec![
                Header::from_bytes(b"Content-Range".as_ref(), content_range.as_bytes())
                    .expect("static header"),
            ];
            (
                206_u16,
                extra_headers,
                Box::new(file.take(length)) as Box<dyn Read + Send>,
                length,
            )
        }
        // An out-of-bounds start is a 416 carrying the current size.
        Range::Slice(..) => {
            let extra_headers = vec![
                Header::from_bytes(
                    b"Content-Range".as_ref(),
                    format!("bytes */{size}").as_bytes(),
                )
                .expect("static header"),
            ];
            (
                416_u16,
                extra_headers,
                Box::new(std::io::empty()) as Box<dyn Read + Send>,
                0,
            )
        }
    };

    let mut headers = extra_headers;
    headers.push(
        Header::from_bytes(b"Accept-Ranges".as_ref(), b"bytes".as_ref()).expect("static header"),
    );
    headers.push(
        Header::from_bytes(b"Content-Type".as_ref(), mime.as_bytes()).expect("static header"),
    );

    let response = Response::new(
        tiny_http::StatusCode(code),
        headers,
        body,
        Some(body_len as usize),
        None,
    );
    let _ = request.respond(response);
    Some(())
}

/// Start (or report the already-running) server. The token is generated once
/// per launch; the URL is returned for the player to build media URLs from.
pub fn start(base_dir: PathBuf, state: &MediaState) -> Result<String, String> {
    let existing = state
        .base_url
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    if let Some(url) = existing {
        return Ok(url);
    }

    let token = generate_token();
    let server = Server::http("127.0.0.1:0").map_err(|error| error.to_string())?;
    let addr = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "no ip listener".to_string())?;
    let prefix = format!("/media/{token}/");

    // The serving loop keeps the server alive for the app's lifetime; the
    // request count is tiny (one per player seek boundary).
    let server_state = (token, base_dir);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let _ = handle_request(request, &server_state.0, &server_state.1);
        }
    });

    let url = format!("http://{addr}{prefix}");
    let mut guard = state.base_url.lock().map_err(|error| error.to_string())?;
    *guard = Some(url.clone());
    Ok(url)
}

fn generate_token() -> String {
    // 16 bytes of OS entropy, hex-encoded: 128 bits is plenty for a
    // local-only gate. Windows has no /dev/urandom; the clock fallback only
    // needs uniqueness within one machine's run.
    let mut seed = [0u8; 16];
    let from_os = std::fs::File::open("/dev/urandom").and_then(|mut file| {
        file.read_exact(&mut seed)?;
        Ok(())
    });
    if from_os.is_err() {
        fill_from_clock(&mut seed);
    }
    seed.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn fill_from_clock(seed: &mut [u8; 16]) {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for (index, byte) in seed.iter_mut().enumerate() {
        *byte = (nanos >> (index * 8)) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::net::TcpStream;
    use std::time::Duration;

    fn temp_base() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hamesh-media-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(dir.join("books")).expect("create base");
        dir
    }

    fn write_book(base: &PathBuf, sha: &str, bytes: &[u8]) {
        let path = base.join("books").join(sha);
        let mut file = File::create(path).expect("create book");
        file.write_all(bytes).expect("write book");
    }

    fn request(base_url: &str, target: &str, extra: &str) -> (u16, Vec<u8>, String) {
        let addr = base_url.trim_start_matches("http://").to_string();
        let host = addr.split('/').next().expect("host").to_string();
        let mut stream = TcpStream::connect(&host).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        let request =
            format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n{extra}\r\n");
        stream.write_all(request.as_bytes()).expect("write");
        let mut buffer = Vec::new();
        stream.read_to_end(&mut buffer).expect("read");
        let text_start = buffer
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("header end");
        let head = String::from_utf8_lossy(&buffer[..text_start]).to_string();
        let status: u16 = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse().ok())
            .expect("status line");
        (status, buffer[text_start + 4..].to_vec(), head)
    }

    #[test]
    fn serves_full_and_ranged_requests_behind_the_token() {
        let base = temp_base();
        let sha = "a".repeat(64);
        write_book(&base, &sha, b"0123456789abcdef");
        let state = MediaState {
            base_url: Mutex::new(None),
        };
        let base_url = start(base.clone(), &state).expect("start");
        let token = base_url
            .split_once("/media/")
            .expect("token in url")
            .1
            .split('/')
            .next()
            .expect("token segment")
            .to_string();

        // Full body with Accept-Ranges.
        let (status, body, head) = request(&base_url, &format!("/media/{token}/{sha}.mp4"), "");
        assert_eq!(status, 200);
        assert_eq!(body, b"0123456789abcdef");
        let head_lower = head.to_ascii_lowercase();
        assert!(head_lower.contains("accept-ranges: bytes"), "{head}");
        assert!(head_lower.contains("content-type: video/mp4"), "{head}");

        // A byte range.
        let (status, body, head) = request(
            &base_url,
            &format!("/media/{token}/{sha}.mp4"),
            "Range: bytes=2-5\r\n",
        );
        assert_eq!(status, 206);
        assert_eq!(body, b"2345");
        assert!(
            head.to_ascii_lowercase()
                .contains("content-range: bytes 2-5/16"),
            "{head}"
        );

        // Open-ended and suffix ranges.
        let (status, body, _) = request(
            &base_url,
            &format!("/media/{token}/{sha}.mp4"),
            "Range: bytes=10-\r\n",
        );
        assert_eq!(status, 206);
        assert_eq!(body, b"abcdef");

        let (status, body, _) = request(
            &base_url,
            &format!("/media/{token}/{sha}.mp4"),
            "Range: bytes=-4\r\n",
        );
        assert_eq!(status, 206);
        assert_eq!(body, b"cdef");

        // Out-of-bounds start is 416 with the size.
        let (status, _, head) = request(
            &base_url,
            &format!("/media/{token}/{sha}.mp4"),
            "Range: bytes=99-\r\n",
        );
        assert_eq!(status, 416);
        assert!(head.to_ascii_lowercase().contains("bytes */16"), "{head}");
    }

    #[test]
    fn rejects_wrong_tokens_unsupported_types_and_missing_files() {
        let base = temp_base();
        let sha = "b".repeat(64);
        write_book(&base, &sha, b"data");
        let state = MediaState {
            base_url: Mutex::new(None),
        };
        let base_url = start(base.clone(), &state).expect("start");
        let token = base_url
            .split_once("/media/")
            .expect("token in url")
            .1
            .split('/')
            .next()
            .expect("token segment")
            .to_string();

        let (status, _, _) = request(&base_url, &format!("/media/wrongtoken/{sha}.mp4"), "");
        assert_eq!(status, 404);

        let (status, _, _) = request(&base_url, &format!("/media/{token}/{sha}.epub"), "");
        assert_eq!(status, 404);

        let missing = "c".repeat(64);
        let (status, _, _) = request(&base_url, &format!("/media/{token}/{missing}.mp4"), "");
        assert_eq!(status, 404);

        // Not hash-shaped: rejected before touching the filesystem.
        let (status, _, _) = request(&base_url, &format!("/media/{token}/../books/{sha}.mp4"), "");
        assert_eq!(status, 404);
    }

    #[test]
    fn start_is_idempotent_and_extension_map_is_exact() {
        let base = temp_base();
        let state = MediaState {
            base_url: Mutex::new(None),
        };
        let first = start(base.clone(), &state).expect("start");
        let second = start(base.clone(), &state).expect("start again");
        assert_eq!(first, second);

        assert_eq!(content_type("mp4"), Some("video/mp4"));
        assert_eq!(content_type("m4v"), Some("video/mp4"));
        assert_eq!(content_type("mkv"), Some("video/x-matroska"));
        assert_eq!(content_type("webm"), Some("video/webm"));
        assert_eq!(content_type("epub"), None);
        assert_eq!(content_type("mp3"), None);
    }
}
