/**
 * 구조화된 로깅 시스템
 *
 * 목적:
 * - 문제 발생 시 원인 파악 용이
 * - 로그 수준별 분류 (info, warn, error)
 * - 타임스탐프 및 컨텍스트 자동 추가
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, any>;
  timestamp: string;
}

/**
 * 로거 클래스
 * - 모든 로그를 일관된 형식으로 기록
 * - 개발 환경: console 출력
 * - 프로덕션: 로그 집계 서비스로 전송 가능 (향후)
 */
class Logger {
  private logs: LogEntry[] = [];

  log(level: LogLevel, module: string, message: string, data?: Record<string, any>) {
    const entry: LogEntry = {
      level,
      module,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(entry);

    // 콘솔 출력
    const prefix = `[${entry.timestamp}] [${module.toUpperCase()}/${level.toUpperCase()}]`;
    const logFn = level === "error" ? console.error : console.log;

    if (data) {
      logFn(`${prefix} ${message}`, data);
    } else {
      logFn(`${prefix} ${message}`);
    }
  }

  info(module: string, message: string, data?: Record<string, any>) {
    this.log("info", module, message, data);
  }

  warn(module: string, message: string, data?: Record<string, any>) {
    this.log("warn", module, message, data);
  }

  error(module: string, message: string, data?: Record<string, any>) {
    this.log("error", module, message, data);
  }

  debug(module: string, message: string, data?: Record<string, any>) {
    if (process.env.NODE_ENV === "development") {
      this.log("debug", module, message, data);
    }
  }

  /** 최근 N개 로그 반환 */
  getRecent(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /** 에러 로그만 반환 */
  getErrors(): LogEntry[] {
    return this.logs.filter((log) => log.level === "error");
  }

  /** 특정 모듈의 로그 반환 */
  getByModule(module: string): LogEntry[] {
    return this.logs.filter((log) => log.module === module);
  }
}

export const logger = new Logger();
