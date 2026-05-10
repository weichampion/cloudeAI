import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

function CopyButton({ text }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
  };
  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded transition-colors"
    >
      复制
    </button>
  );
}

function CodeBlock({ children, className, ...props }) {
  const code = String(children).replace(/\n$/, '');
  return (
    <div className="relative group">
      <pre className="!mt-1 !mb-1">
        <code className={className} {...props}>{children}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

export default function MessageBubble({ role, content, isStreaming }) {
  const isUser = role === 'user';

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start mb-4`}>
      {/* 头像 */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm
        ${isUser ? 'bg-blue-600' : 'bg-slate-600'}`}>
        {isUser ? '你' : '🤖'}
      </div>

      {/* 气泡 */}
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
        ${isUser
          ? 'bg-blue-600 text-white rounded-tr-sm'
          : 'bg-slate-700 text-slate-100 rounded-tl-sm'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                code: CodeBlock,
                img({ src, alt }) {
                  return (
                    <img src={src} alt={alt}
                      className="max-w-full max-h-64 rounded-lg mt-1 cursor-pointer"
                      onClick={() => window.open(src, '_blank')} />
                  );
                },
                a({ href, children }) {
                  return <a href={href} target="_blank" rel="noopener noreferrer"
                    className="text-blue-400 underline">{children}</a>;
                },
              }}
            >
              {content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
