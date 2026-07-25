// 平台判断：管理面板入口只在 PC 显示，Android / iOS 手机不显示
export function isDesktop() {
  return !/Android|iPhone|iPad|iPod|Mobile|HarmonyOS|Windows Phone/i.test(navigator.userAgent)
}
