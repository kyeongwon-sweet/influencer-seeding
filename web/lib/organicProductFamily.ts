// 무상노출 제품 칩 계열 묶음(쫀득바 → 멜론쫀득바·망고쫀득바·그릭복숭아쫀득바 …).
//
// 🚨 2026-10-22 사고: 묶음을 **하위 제품 명시 목록**으로 들고 있었더니, 새 제품 '그릭복숭아쫀득바'(59건)가
//    목록에 없어 '쫀득바'를 눌러도 같이 켜지지 않았다. 반대로 '그릭복숭아쫀득바'를 누르면 '쫀득바'는 켜지는
//    짝짝이 동작이었다(하위→상위는 접미사로, 상위→하위는 목록으로 판정해서).
// → 이제 하위 제품은 **데이터에 있는 이름 중 계열명으로 끝나는 것 전부**다. 새 제품이 생겨도 자동으로 묶인다.
//    묶으면 안 되는 것만 GROUP_EXCLUDES 에 적는다(사용자 지정). 위·아래 두 방향이 같은 함수(familyOf)를 쓴다.

/** 칩 정렬·묶음의 계열. 순서가 곧 칩 순서다. */
export const PRODUCT_FAMILY_ORDER = ["듬뿍바", "쫀득바", "초코바", "제로바", "요거트바", "파인트", "모나카", "빵샌드"];

/**
 * 이름은 같은 계열로 끝나지만 상위 칩과 함께 묶으면 안 되는 제품(2026-08-04 사용자 지정).
 * 초코바 ← 넛티초코바(넛티 계열)·초콜릿초코바 제외 / 듬뿍바 ← 옥수수듬뿍바 제외.
 * ⚠️ '망고요거트파인트'처럼 이름에 요거트가 있어도 '…파인트'로 끝나면 파인트다(요거트바 아님) — 접미사 판정이라 자동으로 맞는다.
 */
export const GROUP_EXCLUDES: Record<string, readonly string[]> = {
  "초코바": ["넛티초코바", "초콜릿초코바"],
  "듬뿍바": ["옥수수듬뿍바"],
};

/** 이 제품이 묶이는 상위 계열. 계열 자신·제외 제품·계열 없는 제품은 null. */
export function familyOf(product: string): string | null {
  for (const family of PRODUCT_FAMILY_ORDER) {
    if (product === family || !product.endsWith(family)) continue;
    if (GROUP_EXCLUDES[family]?.includes(product)) return null;
    return family;
  }
  return null;
}

/** 상위 칩을 누르면 함께 켜지고 꺼지는 하위 제품들(지금 데이터에 있는 이름 기준). */
export function familyMembers(family: string, allProducts: readonly string[]): string[] {
  return allProducts.filter(p => familyOf(p) === family);
}

export function isProductFamily(product: string): boolean {
  return PRODUCT_FAMILY_ORDER.includes(product);
}

/**
 * 제품 칩 하나를 눌렀을 때의 새 선택 목록.
 * · 상위(계열) 칩: 그 계열 하위 제품 전부와 함께 켜지고 함께 꺼진다.
 * · 하위 칩: 켜면 상위도 켜지고, 끄면 같은 계열 하위가 하나도 안 남을 때 상위도 꺼진다.
 */
export function toggleProductSelection(selected: readonly string[], product: string, allProducts: readonly string[]): string[] {
  if (isProductFamily(product)) {
    const group = familyMembers(product, allProducts);
    if (selected.includes(product)) {
      const drop = new Set([product, ...group]);
      return selected.filter(x => !drop.has(x));
    }
    return [...selected, ...[product, ...group].filter(x => !selected.includes(x))];
  }
  const parent = familyOf(product);
  if (selected.includes(product)) {
    let next = selected.filter(x => x !== product);
    if (parent && next.includes(parent) && !next.some(x => familyOf(x) === parent)) next = next.filter(x => x !== parent);
    return next;
  }
  const next = [...selected, product];
  if (parent && !next.includes(parent)) next.push(parent);
  return next;
}
