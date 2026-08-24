function isJsonl(name) {
  return /\.jsonl$/i.test(name || "");
}

function entriesFromFiles(files) {
  return [...files]
    .filter((file) => isJsonl(file.webkitRelativePath || file.name))
    .map((file) => ({ name: file.webkitRelativePath || file.name, file: () => Promise.resolve(file) }));
}

async function entriesFromHandle(handle, prefix = "") {
  const entries = [];
  for await (const [name, child] of handle.entries()) {
    const full = prefix ? `${prefix}/${name}` : name;
    try {
      if (child.kind === "directory") entries.push(...await entriesFromHandle(child, full));
      else if (isJsonl(name)) entries.push({ name: full, file: () => child.getFile() });
    } catch {}
  }
  return entries;
}

function readEntry(entry, prefix = "") {
  return new Promise((resolve) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      if (!isJsonl(entry.name)) return resolve([]);
      return entry.file((file) => resolve([{ name, file: () => Promise.resolve(file) }]), () => resolve([]));
    }
    if (!entry.isDirectory) return resolve([]);
    const reader = entry.createReader();
    const all = [];
    const next = () => reader.readEntries(async (batch) => {
      if (!batch.length) return resolve((await Promise.all(all)).flat());
      all.push(...batch.map((child) => readEntry(child, name)));
      next();
    }, () => resolve([]));
    next();
  });
}

async function entriesFromDrop(data) {
  const entries = [];
  for (const item of data.items || []) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(...await readEntry(entry));
  }
  return entries.length ? entries : entriesFromFiles(data.files || []);
}

export { entriesFromDrop, entriesFromFiles, entriesFromHandle };
