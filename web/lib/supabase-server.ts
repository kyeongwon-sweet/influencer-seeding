import { createClient, SupabaseClient } from "@supabase/supabase-js";

// 스키마 제네릭이 없으면 .from()이 never로 추론돼 전 라우트에서 가짜 타입에러가 발생함.
// DB 타입을 생성하기 전까지는 <any>로 느슨하게 둬서 런타임 영향 없이 거짓 에러만 제거.
let _supabase: SupabaseClient<any, any, any> | null = null;

export function getServerSupabase(): SupabaseClient<any, any, any> {
  if (!_supabase) {
    _supabase = createClient<any, any, any>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase!;
}
