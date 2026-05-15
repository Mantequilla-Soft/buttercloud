// Format bytes to human-readable sizes (GB, MB, KB, B)
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Format cents to USD (e.g., 1000 → $10.00)
export function formatCurrency(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// Format ISO date to readable string
export function formatDate(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Get file type from filename
export function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const typeMap = {
    'jpg': 'img', 'jpeg': 'img', 'png': 'img', 'gif': 'img', 'webp': 'img', 'svg': 'img',
    'mp4': 'video', 'webm': 'video', 'mov': 'video', 'avi': 'video',
    'mp3': 'audio', 'wav': 'audio', 'ogg': 'audio', 'flac': 'audio',
    'pdf': 'doc', 'docx': 'doc', 'doc': 'doc', 'txt': 'doc', 'xlsx': 'doc', 'xls': 'doc',
    'zip': 'archive', '7z': 'archive', 'rar': 'archive', 'tar': 'archive', 'gz': 'archive',
    'js': 'code', 'ts': 'code', 'jsx': 'code', 'tsx': 'code', 'py': 'code', 'java': 'code', 'cpp': 'code', 'c': 'code', 'go': 'code', 'rs': 'code', 'yaml': 'code', 'yml': 'code', 'json': 'code', 'xml': 'code', 'html': 'code', 'css': 'code',
  };
  return typeMap[ext] || 'file';
}
