import { v4 as uuidv4 } from 'uuid';

// 获取或生成持久用户ID（存 localStorage）
export function getUserId() {
  let id = localStorage.getItem('user_id');
  if (!id) {
    id = uuidv4();
    localStorage.setItem('user_id', id);
  }
  return id;
}

export function getNickname() {
  return localStorage.getItem('nickname') || '';
}

export function setNickname(name) {
  localStorage.setItem('nickname', name);
}
