import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Part, ToolPart } from '@opencode-ai/sdk'
import {
  AlertIcon,
  BrainIcon,
  CheckIcon,
  ChevronRightIcon,
  FileIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  ToolIcon,
} from './Icons'
import { Widget, WidgetPending } from './Widget'

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'text'}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

// complete=false while the text is still streaming: widgets wait so the frame isn't rebuilt per token
export function Markdown({ text, complete = true }: { text: string; complete?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className ?? '')
            const content = String(children ?? '')
            if (match?.[1] === 'widget') {
              return complete ? <Widget html={content} /> : <WidgetPending />
            }
            // fenced blocks carry a language class or span multiple lines; everything else is inline
            if (match || content.includes('\n')) {
              return <CodeBlock lang={match?.[1] ?? ''} code={content.replace(/\n$/, '')} />
            }
            return <code className="inline-code">{children}</code>
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function toolIcon(tool: string): ReactNode {
  const t = tool.toLowerCase()
  if (t.includes('bash') || t.includes('shell')) return <TerminalIcon size={14} />
  if (t.includes('edit') || t.includes('write') || t.includes('patch')) return <PencilIcon size={14} />
  if (t.includes('read') || t.includes('list')) return <FileIcon size={14} />
  if (t.includes('grep') || t.includes('glob') || t.includes('search')) return <SearchIcon size={14} />
  if (t.includes('fetch') || t.includes('web')) return <GlobeIcon size={14} />
  return <ToolIcon size={14} />
}

function toolSummary(part: ToolPart): string {
  const s = part.state
  if ('title' in s && s.title) return s.title
  const input = s.input ?? {}
  const pick = input.command ?? input.filePath ?? input.path ?? input.pattern ?? input.url ?? input.description
  return typeof pick === 'string' ? pick : ''
}

function ToolCall({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const s = part.state
  const running = s.status === 'pending' || s.status === 'running'
  const duration = s.status === 'completed' || s.status === 'error' ? ((s.time.end - s.time.start) / 1000).toFixed(1) + 's' : null

  return (
    <div className={`tool ${s.status}`}>
      <button type="button" className="tool-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronRightIcon size={12} className={open ? 'tool-chevron open' : 'tool-chevron'} />
        <span className="tool-icon">{toolIcon(part.tool)}</span>
        <span className="tool-name">{part.tool}</span>
        <span className="tool-summary">{toolSummary(part)}</span>
        <span className="tool-status">
          {running && <span className="spinner" />}
          {s.status === 'completed' && <CheckIcon size={13} />}
          {s.status === 'error' && <AlertIcon size={13} />}
          {duration && <span className="tool-time">{duration}</span>}
        </span>
      </button>
      {open && (
        <div className="tool-body">
          <div className="tool-label">Input</div>
          <pre>{JSON.stringify(s.input, null, 2)}</pre>
          {s.status === 'completed' && s.output && (
            <>
              <div className="tool-label">Output</div>
              <pre>{s.output.length > 8000 ? s.output.slice(0, 8000) + '\n…' : s.output}</pre>
            </>
          )}
          {s.status === 'error' && (
            <>
              <div className="tool-label">Error</div>
              <pre className="tool-error">{s.error}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="reasoning">
      <button type="button" className="reasoning-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <BrainIcon size={14} />
        <span className={live ? 'shimmer' : ''}>{live ? 'Thinking' : 'Thought'}</span>
        <ChevronRightIcon size={12} className={open ? 'tool-chevron open' : 'tool-chevron'} />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  )
}

export function PartView({ part, live }: { part: Part; live: boolean }) {
  switch (part.type) {
    case 'text':
      return part.ignored || !part.text ? null : <Markdown text={part.text} complete={!live || !!part.time?.end} />
    case 'reasoning':
      return part.text ? <Reasoning text={part.text} live={live && !part.time?.end} /> : null
    case 'tool':
      return <ToolCall part={part} />
    default:
      return null
  }
}
