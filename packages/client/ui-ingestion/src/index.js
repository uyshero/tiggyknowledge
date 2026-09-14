import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle2, FileText, RotateCcw, Upload, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
export const inject = ['clientApp', 'connection'];
const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.markdown'];
const MAX_FILE_SIZE = 25 * 1024 * 1024;
function formatBytes(size) {
    if (size < 1024)
        return `${size} B`;
    if (size < 1024 * 1024)
        return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
function fileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
}
export function apply(ctx) {
    function IngestionPage() {
        const inputRef = useRef(null);
        const [libraries, setLibraries] = useState([]);
        const [libraryId, setLibraryId] = useState('');
        const [files, setFiles] = useState([]);
        const [result, setResult] = useState();
        const [error, setError] = useState();
        const [loading, setLoading] = useState(true);
        const [uploading, setUploading] = useState(false);
        const [dragging, setDragging] = useState(false);
        useEffect(() => {
            const controller = new AbortController();
            void ctx.connection.libraries(controller.signal).then(items => {
                setLibraries(items);
                setLibraryId(items[0]?.id ?? '');
            }).catch((reason) => {
                if (!controller.signal.aborted)
                    setError(reason instanceof Error ? reason.message : '无法读取知识库');
            }).finally(() => {
                if (!controller.signal.aborted)
                    setLoading(false);
            });
            return () => controller.abort();
        }, []);
        const stageFiles = (incoming) => {
            const accepted = [];
            const rejected = [];
            for (const file of incoming) {
                const lower = file.name.toLowerCase();
                if (!ACCEPTED_EXTENSIONS.some(extension => lower.endsWith(extension))) {
                    rejected.push(`${file.name}：格式不支持`);
                }
                else if (file.size > MAX_FILE_SIZE) {
                    rejected.push(`${file.name}：超过 25 MB`);
                }
                else {
                    accepted.push(file);
                }
            }
            setFiles(current => {
                const known = new Set(current.map(fileKey));
                return [...current, ...accepted.filter(file => !known.has(fileKey(file)))].slice(0, 50);
            });
            setResult(undefined);
            setError(rejected.length === 0 ? undefined : rejected.join('；'));
        };
        const onFileChange = (event) => {
            stageFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
        };
        const onDrop = (event) => {
            event.preventDefault();
            setDragging(false);
            stageFiles(Array.from(event.dataTransfer.files));
        };
        const uploadFiles = async () => {
            if (uploading || libraryId.length === 0 || files.length === 0)
                return;
            setUploading(true);
            setError(undefined);
            try {
                const next = await ctx.connection.ingestFiles(libraryId, files);
                setResult(next);
                setFiles([]);
            }
            catch (reason) {
                setError(reason instanceof Error ? reason.message : '批量上传失败');
            }
            finally {
                setUploading(false);
            }
        };
        return (_jsxs("div", { className: "page ingestion-page", children: [_jsxs("header", { className: "page-header compact-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u672C\u5730\u7A7A\u95F4" }), _jsx("h1", { children: "\u4E0A\u4F20\u4E2D\u5FC3" })] }), _jsxs("div", { className: "header-actions", children: [_jsxs("button", { className: "secondary-button", type: "button", disabled: uploading, onClick: () => inputRef.current?.click(), children: [_jsx(FileText, { size: 16 }), "\u9009\u62E9\u6587\u4EF6"] }), _jsxs("button", { className: "primary-button", type: "button", disabled: uploading || files.length === 0 || libraryId.length === 0, onClick: () => void uploadFiles(), children: [_jsx(Upload, { size: 16 }), uploading ? '处理中...' : `导入 ${files.length || ''}`] })] })] }), _jsx("input", { ref: inputRef, className: "visually-hidden", type: "file", multiple: true, accept: ".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf", onChange: onFileChange }), _jsxs("div", { className: "ingestion-workspace", children: [_jsxs("section", { className: "ingestion-toolbar", "aria-label": "\u5BFC\u5165\u76EE\u6807", children: [_jsxs("label", { children: [_jsx("span", { children: "\u76EE\u6807\u77E5\u8BC6\u5E93" }), _jsx("select", { disabled: loading || uploading || libraries.length === 0, value: libraryId, onChange: event => setLibraryId(event.target.value), children: libraries.map(library => _jsx("option", { value: library.id, children: library.name }, library.id)) })] }), _jsxs("div", { children: [_jsx("strong", { children: "\u652F\u6301 TXT\u3001Markdown\u3001PDF" }), _jsx("span", { children: "\u5355\u6587\u4EF6\u4E0D\u8D85\u8FC7 25 MB\uFF0C\u6BCF\u6279\u6700\u591A 50 \u4E2A" })] })] }), libraries.length === 0 && !loading ? (_jsxs("div", { className: "workspace-state", children: [_jsx("span", { children: "\u8BF7\u5148\u521B\u5EFA\u4E00\u4E2A\u77E5\u8BC6\u5E93\uFF0C\u518D\u5BFC\u5165\u6587\u4EF6\u3002" }), _jsx("button", { className: "secondary-button", type: "button", onClick: () => ctx.clientApp.selectPage('knowledge'), children: "\u8FD4\u56DE\u77E5\u8BC6\u5E93" })] })) : result !== undefined ? (_jsxs("section", { className: "ingestion-results", "aria-labelledby": "ingestion-result-title", children: [_jsxs("div", { className: "ingestion-section-heading", children: [_jsxs("div", { children: [_jsx("h2", { id: "ingestion-result-title", children: "\u672C\u6B21\u5BFC\u5165\u5B8C\u6210" }), _jsxs("p", { children: ["\u6210\u529F ", result.importedFiles, "\uFF0C\u91CD\u590D ", result.duplicateFiles, "\uFF0C\u5931\u8D25 ", result.failedFiles] })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => setResult(undefined), children: [_jsx(RotateCcw, { size: 15 }), "\u7EE7\u7EED\u5BFC\u5165"] })] }), _jsx("div", { className: "ingestion-file-list", children: result.results.map((item, index) => _jsxs("div", { className: "ingestion-result-row", children: [_jsx("span", { className: `result-icon result-${item.status}`, children: item.status === 'imported' ? _jsx(CheckCircle2, { size: 17 }) : item.status === 'duplicate' ? _jsx(RotateCcw, { size: 17 }) : _jsx(XCircle, { size: 17 }) }), _jsxs("div", { children: [_jsx("strong", { children: item.fileName }), _jsx("span", { children: item.status === 'imported' ? '已写入并完成全文索引' : item.message })] }), _jsx("em", { children: item.status === 'imported' ? '已导入' : item.status === 'duplicate' ? '重复' : '失败' })] }, `${item.fileName}:${index}`)) })] })) : (_jsxs("section", { className: "ingestion-staging", "aria-labelledby": "staging-title", children: [_jsxs("div", { className: `upload-dropzone ${dragging ? 'dragging' : ''}`, onDragEnter: event => { event.preventDefault(); setDragging(true); }, onDragOver: event => event.preventDefault(), onDragLeave: () => setDragging(false), onDrop: onDrop, children: [_jsx(Upload, { size: 24 }), _jsx("h2", { id: "staging-title", children: "\u62D6\u653E\u6587\u4EF6\u5230\u8FD9\u91CC" }), _jsx("p", { children: "\u4E5F\u53EF\u4EE5\u4ECE\u672C\u673A\u9009\u62E9\u591A\u4E2A\u6587\u4EF6" }), _jsx("button", { className: "secondary-button", type: "button", onClick: () => inputRef.current?.click(), children: "\u9009\u62E9\u6587\u4EF6" })] }), files.length > 0 && _jsx("div", { className: "ingestion-file-list", "aria-label": "\u5F85\u5BFC\u5165\u6587\u4EF6", children: files.map(file => _jsxs("div", { className: "ingestion-file-row", children: [_jsx(FileText, { size: 17 }), _jsxs("div", { children: [_jsx("strong", { children: file.name }), _jsx("span", { children: formatBytes(file.size) })] }), _jsx("button", { className: "icon-button", type: "button", title: `移除 ${file.name}`, disabled: uploading, onClick: () => setFiles(current => current.filter(item => fileKey(item) !== fileKey(file))), children: _jsx(X, { size: 16 }) })] }, fileKey(file))) })] })), error !== undefined && _jsx("div", { className: "form-error ingestion-error", role: "alert", children: error })] })] }));
    }
    ctx.effect(() => ctx.clientApp.registerPage({
        id: 'ingestion',
        label: '上传',
        icon: Upload,
        component: IngestionPage,
        order: 20,
        section: 'primary',
    }), 'ui-ingestion: page');
}
//# sourceMappingURL=index.js.map
