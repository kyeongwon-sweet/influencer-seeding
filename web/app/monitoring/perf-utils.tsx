"use client";
import { useEffect, useRef, useState } from "react";

// 수집 경과시간 — 자체 state/interval로 1초마다 "이 컴포넌트만" 리렌더.
// (예전엔 부모 MonitoringPage의 state라 매초 페이지 전체+표 전체가 리렌더됐음)
// running일 때만 렌더되므로 마운트=0초 시작, 언마운트 시 interval 정리.
export function ElapsedTimer() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setS(v => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-xs text-a-ink-muted tabular-nums">
      {s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`}
    </span>
  );
}

// 핸들러 묶음을 "정체성 고정"으로 만들어 React.memo(PostsTable)가 실제로 동작하게 함.
// 반환된 함수들은 매번 같은 참조지만 항상 최신 클로저를 호출 → deps 신경 안 써도 stale 없음.
// (key 집합은 호출 동안 불변이라는 전제 — 본 페이지의 핸들러 묶음은 고정)
type StableHandler = (...args: never[]) => unknown;

export function useStableHandlers<T extends Record<string, StableHandler>>(handlers: T): T {
  const ref = useRef(handlers);
  ref.current = handlers;
  const stableRef = useRef<T | null>(null);
  if (stableRef.current === null) {
    const out = {} as T;
    for (const key of Object.keys(handlers) as Array<keyof T>) {
      out[key] = ((...args: Parameters<T[typeof key]>) => ref.current[key](...args)) as T[typeof key];
    }
    stableRef.current = out;
  }
  return stableRef.current;
}
