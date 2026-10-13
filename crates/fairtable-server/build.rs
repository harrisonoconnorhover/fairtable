use std::{env, fs, io, path::Path};

fn copy_assets(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        println!("cargo:rerun-if-changed={}", path.display());
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_assets(&path, &target)?;
        } else if entry.file_type()?.is_file() {
            fs::copy(path, target)?;
        }
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let assets = root.join("dist");
    let output = std::path::PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("ui");
    println!("cargo:rerun-if-changed={}", assets.display());
    if output.exists() {
        fs::remove_dir_all(&output)?;
    }
    fs::create_dir_all(&output)?;
    if assets.join("index.html").is_file() {
        copy_assets(&assets, &output)?;
    } else {
        fs::write(output.join("index.html"), "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Fairtable</title><body><h1>Fairtable server is running</h1><p>The web interface has not been built. Run npm run build, then rebuild the server, or set FAIRTABLE_ASSETS to your built dist directory.</p></body></html>")?;
        println!("cargo:warning=dist/index.html is absent; embedding a development placeholder");
    }
    Ok(())
}
