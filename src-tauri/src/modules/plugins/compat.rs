//! 版本兼容判定 —— 插件能不能装，只由这里回答。
//!
//! ## 为什么不用 semver 区间
//!
//! 两个上游项目声明兼容性的方式**根本不同**，硬套统一语义会凭空造出上游从未
//! 承诺过的信息：
//!
//! | 上游 | 声明方式 |
//! |---|---|
//! | `KongBai1145/claude-code-zh-cn` | **逐版本枚举**（`support-window.json` 的
//!   `versions` 数组），还带 `excluded` 反向清单，并分 `stable` / `experimental` 两档 |
//! | `javaht/claude-desktop-zh-cn` | **完全不声明** —— 全仓 README/docs 无任何版本号，
//!   安装脚本无 `MinVersion`/`MaxVersion` 门，靠"打完补丁自校验，结构变了就报错" |
//!
//! 所以这里存的是**上游原文的版本列表**，匹配用前缀相等而非区间：上游给什么
//! 就查什么。`[1, 1, 13]` 不在列表里就不是 `Verified`，没有"应该也算"的推断。
//!
//! ## 三态而非布尔的必要性
//!
//! 对一个空白的 Desktop 版本列表，正确答案不是"不兼容"，而是**"上游没说"** ——
//! 这两句话给用户的行动指引完全不同：前者是"别装"，后者是"可以装，但你现在
//! 是在承担上游没替你验过的风险"。合并成一个布尔，第二种情况就会被谎报成第一种。

use super::{CompatRange, CompatStatus, PluginTarget};
use std::cmp::Ordering;

/// 把 `"2.1.153"` 解析成数字段。非数字段按 `0` 处理，保证坏输入不会 panic。
///
/// 与上游 `patch-cli.js` 的版本读取一致：只要能分出大小即可，不追求语义化
/// 完整性 —— Claude 的版本号本来也不是严格 semver（Desktop 是 `2.2553.1`，
/// Code 是 `2.1.153`，两者量级完全不同）。
pub fn parse(v: &str) -> Vec<u64> {
    v.split('.')
        .map(|s| s.trim().trim_start_matches('v').parse::<u64>().unwrap_or(0))
        .collect()
}

/// 比较两个版本号。段数不同时按缺段为 `0` 补齐，所以 `2.1` == `2.1.0`。
pub fn cmp(a: &str, b: &str) -> Ordering {
    let (x, y) = (parse(a), parse(b));
    let n = x.len().max(y.len());
    for i in 0..n {
        let l = x.get(i).copied().unwrap_or(0);
        let r = y.get(i).copied().unwrap_or(0);
        if l != r {
            return l.cmp(&r);
        }
    }
    Ordering::Equal
}

/// 用前缀匹配上游已枚举的版本清单。
///
/// `1.15200` 命中 `1.15200.0.0` 是有意的：上游常按**短形式**写清单，而安装后
/// 读到的是长形式。前缀匹配恢复了两者之间的等价关系，且不会把 `1.152` 误判成
/// `1.15200` —— 段边界由 `.` 保证。
fn listed(range: &[String], current: &str) -> bool {
    range.iter().any(|known| {
        current == known
            || current
                .split('.')
                .take(known.split('.').count())
                .collect::<Vec<_>>()
                .join(".")
                == *known
    })
}

/// 取该 target 的相关版本清单，并说明它们各自的档位。
///
/// 返回 `(stable, experimental, 上游档位说明)`。Desktop 走不到这条路径的
/// experimental 分支 —— 它根本没有清单。
fn windows(range: &CompatRange, target: PluginTarget) -> (&[String], &[String], &str) {
    match target {
        PluginTarget::ClaudeDesktop => (&range.desktop, &[], "上游未发布版本矩阵"),
        _ => (
            &range.code_stable,
            &range.code_experimental,
            "npm stable / native experimental",
        ),
    }
}

/// 判定一个插件在"当前这个 target + 当前这个版本"下能否安装。
///
/// 判定顺序刻意把**无法确认**排在**明确不兼容**之前：能读出版本才有资格说
/// "不兼容"，读不出版本时说"不兼容"是在编造一个我们没做过的测量。
pub fn evaluate(
    range: &CompatRange,
    target: PluginTarget,
    installed: bool,
    current: Option<&str>,
) -> (CompatStatus, String) {
    if !installed {
        return (
            CompatStatus::TargetMissing,
            format!("{} 未安装，无从判断兼容性。", target.label()),
        );
    }

    let current = match current {
        Some(v) => v,
        None => {
            return (
                CompatStatus::UnknownVersion,
                format!("{} 已安装，但版本号无法读取。", target.label()),
            );
        }
    };

    let (stable, experimental, tier) = windows(range, target);

    // 上游一个版本都没声明 —— 这是 Desktop 的真实状态，也是最需要三态的地方。
    if stable.is_empty() && experimental.is_empty() {
        return (
            CompatStatus::Unverified,
            format!(
                "当前 {current}：{tier}。上游不发布已验证版本清单，安装后由其自校验，\
                 结构不匹配会报错而非静默跳过（README「版本变化」章节）。\
                 因此按未验证处理，需要你确认风险后才能继续。"
            ),
        );
    }

    if listed(stable, current) {
        return (
            CompatStatus::Verified,
            format!("当前 {current} 在上游已验证清单内（{tier}）。"),
        );
    }

    if listed(experimental, current) {
        return (
            CompatStatus::Unverified,
            format!(
                "当前 {current} 上游标记为 **experimental**（{tier}）：已做局部验证，\
                 但不承诺与 stable 同等体验。按未验证处理。"
            ),
        );
    }

    // 有清单却不在清单里 —— 再区分"太旧"和"太新"，两者的措辞不同：
    // 太旧是真的不支持，太新只是还没轮到它被验。
    let floor = stable.iter().chain(experimental.iter()).min_by(|a, b| cmp(a, b));
    let ceiling = stable.iter().chain(experimental.iter()).max_by(|a, b| cmp(a, b));

    if let Some(floor) = floor {
        if cmp(current, floor) == Ordering::Less {
            return (
                CompatStatus::Incompatible,
                format!(
                    "当前 {current} 低于上游最低支持版本 {floor}，明确不兼容。\
                     请先升级 {}，或改用不改二进制的 Layer 1–3。",
                    target.label()
                ),
            );
        }
        if let Some(ceiling) = ceiling {
            if cmp(current, ceiling) == Ordering::Greater {
                return (
                    CompatStatus::Unverified,
                    format!(
                        "当前 {current} 高于上游最后验证的 {ceiling}。\
                         上游明确声明「不代表 future latest 自动稳定」，故按未验证处理。"
                    ),
                );
            }
        }
    }

    (
        CompatStatus::Unverified,
        format!(
            "当前 {current} 不在上游清单内。上游清单共 {} 个版本，\
             含显式排除项；未被列举即未验证。",
            stable.len() + experimental.len()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range() -> CompatRange {
        CompatRange {
            desktop: vec![],
            code_stable: vec!["2.1.92".into(), "2.1.112".into()],
            code_experimental: vec!["2.1.113".into(), "2.1.153".into()],
            note: String::new(),
        }
    }

    #[test]
    fn parses_numeric_segments() {
        assert_eq!(parse("2.1.153"), vec![2, 1, 153]);
        assert_eq!(parse("v2.1.153"), vec![2, 1, 153]);
        // 坏输入不 panic，且被当成最低值 —— 不会被误判成"比谁都新"。
        assert_eq!(parse("not-a-version"), vec![0]);
    }

    #[test]
    fn compares_across_different_lengths() {
        assert_eq!(cmp("2.1", "2.1.0"), Ordering::Equal);
        assert_eq!(cmp("2.1.92", "2.1.112"), Ordering::Less);
        assert_eq!(cmp("0.9.9", "0.9.10"), Ordering::Less);
        assert_eq!(cmp("2.2553.1", "2.1.153"), Ordering::Greater);
    }

    #[test]
    fn desktop_without_a_published_matrix_is_unverified_not_incompatible() {
        let (s, why) = evaluate(&range(), PluginTarget::ClaudeDesktop, true, Some("2.2553.1"));
        assert_eq!(s, CompatStatus::Unverified);
        // 关键：措辞必须区分"上游没说"与"我们测过说不行"。
        assert!(why.contains("未发布版本矩阵"), "{why}");
        assert!(!why.contains("不兼容"), "{why}");
        // 未验证 = 默认不放行。
        assert!(!s.allows_install());
    }

    #[test]
    fn stable_window_is_the_only_verified_state() {
        let (s, _) = evaluate(&range(), PluginTarget::ClaudeCode, true, Some("2.1.112"));
        assert_eq!(s, CompatStatus::Verified);
        assert!(s.allows_install());
    }

    #[test]
    fn experimental_window_is_unverified_with_a_distinct_reason() {
        let (s, why) = evaluate(&range(), PluginTarget::ClaudeCode, true, Some("2.1.153"));
        assert_eq!(s, CompatStatus::Unverified);
        assert!(why.contains("experimental"), "{why}");
    }

    #[test]
    fn prefix_match_covers_the_long_form_upstream_lists_shortly() {
        // support-window.json 写 "2.1.153"，本机读到的可能是长形式。
        let (s, _) = evaluate(&range(), PluginTarget::ClaudeCode, true, Some("2.1.153.9"));
        assert_eq!(s, CompatStatus::Unverified);
        assert!(listed(&range().code_experimental, "2.1.153.9"));
    }

    #[test]
    fn below_the_floor_is_incompatible_with_an_upgrade_hint() {
        let (s, why) = evaluate(&range(), PluginTarget::ClaudeCode, true, Some("2.0.1"));
        assert_eq!(s, CompatStatus::Incompatible);
        assert!(why.contains("2.1.92"), "{why}");
    }

    #[test]
    fn above_the_ceiling_is_unverified_because_upstream_disclaims_it() {
        let (s, why) = evaluate(&range(), PluginTarget::ClaudeCode, true, Some("2.2.1"));
        assert_eq!(s, CompatStatus::Unverified);
        assert!(why.contains("future latest"), "{why}");
    }

    #[test]
    fn uninstalled_target_short_circuits_before_any_version_claim() {
        let (s, why) = evaluate(&range(), PluginTarget::ClaudeCode, false, None);
        assert_eq!(s, CompatStatus::TargetMissing);
        assert!(why.contains("未安装"), "{why}");
        assert!(!s.allows_install());
    }

    #[test]
    fn installed_but_unreadable_version_is_its_own_state() {
        let (s, _) = evaluate(&range(), PluginTarget::ClaudeCode, true, None);
        assert_eq!(s, CompatStatus::UnknownVersion);
        assert!(!s.allows_install());
    }
}
