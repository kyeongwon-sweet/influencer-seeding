function myFunction() {
  function fillCompanyFromLearned() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function(s){return s.getSheetId()===1937186871;})[0];
  var ui = SpreadsheetApp.getUi();
  if(!sheet){ ui.alert('연동 탭(gid 1937186871)을 못 찾음'); return; }
  var lastRow=sheet.getLastRow(), lastCol=sheet.getLastColumn();
  if(lastRow<2){ ui.alert('데이터 없음'); return; }
  var header=sheet.getRange(1,1,1,lastCol).getValues()[0];
  var norm=function(v){return String(v==null?'':v).replace(/\s+/g,'').toLowerCase();};
  function colOf(n){for(var i=0;i<header.length;i++){if(norm(header[i])===norm(n))return i;}return -1;}
  var cCo=colOf('업체명'), cType=colOf('채널 분류'), cAcc=colOf('채널명');
  if(cCo<0||cType<0||cAcc<0){ ui.alert('헤더(업체명/채널 분류/채널명) 못 찾음'); return; }
  var data=sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  var acc2co={};
  for(var r=0;r<data.length;r++){ var a=String(data[r][cAcc]||'').trim(), c=String(data[r][cCo]||'').trim(); if(a&&c){(acc2co[a]=acc2co[a]||{})[c]=true;} }
  var uniq={}; for(var k in acc2co){ var ks=Object.keys(acc2co[k]); if(ks.length===1) uniq[k]=ks[0]; }
  var ups=[];
  for(var r2=0;r2<data.length;r2++){
    var ct=String(data[r2][cType]||''), a2=String(data[r2][cAcc]||'').trim(), c2=String(data[r2][cCo]||'').trim();
    if(c2) continue;                       // 이미 채워짐
    if(ct.indexOf('바이럴')<0) continue;   // 바이럴만(위성채널·협찬 제외)
    if(uniq[a2]) ups.push({row:r2+2, co:uniq[a2]});
  }
  if(!ups.length){ ui.alert('채울 바이럴 업체명 공란이 없습니다.'); return; }
  var resp=ui.alert('업체명 채우기', ups.length+'개 바이럴 행의 빈 업체명을 계정 학습값으로 채웁니다. 진행할까요?', ui.ButtonSet.YES_NO);
  if(resp!==ui.Button.YES) return;
  ups.forEach(function(u){ sheet.getRange(u.row, cCo+1).setValue(u.co); });
  ui.alert(ups.length+'개 업체명을 채웠습니다.');
}
}
