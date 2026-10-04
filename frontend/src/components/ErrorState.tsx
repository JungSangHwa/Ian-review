type ErrorStateProps = {
  title?: string
  message?: string
  onRetry?: () => void
}

export default function ErrorState({
  title = '문제가 발생했습니다.',
  message = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="state-card state-card--error" role="alert">
      <span className="state-icon" aria-hidden="true">!</span>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
        {onRetry && (
          <button className="button button--secondary" type="button" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  )
}
