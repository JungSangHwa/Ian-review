type LoadingStateProps = {
  message?: string
}

export default function LoadingState({ message = '데이터를 불러오는 중입니다.' }: LoadingStateProps) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div>
        <strong>잠시만요</strong>
        <p>{message}</p>
      </div>
    </div>
  )
}
