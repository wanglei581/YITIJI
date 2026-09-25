# 远程旧分支清理记录（2026-09-25，商业收口步骤 0.7：368 → 34）

产品负责人授权按三方推荐执行，2026-09-25 晚已执行：每个分支删除时都带「远程最新提交仍等于下表提交号」的保护，三批共 259 个全部删除、零拒绝，远程分支 368 → 109。只删两类：最新提交已是 `main` 祖先的分支，以及对应 PR 已合并、且合并后没有新提交的分支。其余（合并后又有提交、PR 关闭未合并、从未开 PR）共 102 个本次不动，逐个判断后另行处理；`main`、整合分支、备份分支与待抽取的 4 个分支保留。

**恢复方法：** 任何一个分支都能按下表的完整提交号重建（这些提交或在 `main` 历史里，或由已合并 PR 的 `refs/pull/<号>/head` 永久引用，不会被回收）：`git push origin <提交号>:refs/heads/<分支名>`；PR 已合并的分支也可在该 PR 页面点「Restore branch」。

共 259 个：

| 分支 | 最新提交 | 日期 | 依据 |
| --- | --- | --- | --- |
| `ci/profile-guard-full-history-20260711` | `f8fd5654de55648157c6510b8d70acb170cea309` | 2026-07-12 | PR 已合并，合并后无新提交（#184:MERGED） |
| `claude/determined-volhard-d7e154` | `dde9b67f8c4b0c736298bc58addad456a34e2234` | 2026-08-02 | PR 已合并，合并后无新提交（#481:MERGED） |
| `claude/fervent-bohr-9259aa` | `d09e9e57d5c5c2c1aee64053b093e605d8c0077c` | 2026-08-04 | PR 已合并，合并后无新提交（#498:MERGED,#482:MERGED） |
| `claude/file-upload-aio-device-e74a2d` | `3a88d38c48e21a2a4902563a2b4fa6bba1a7b9df` | 2026-07-11 | PR 已合并，合并后无新提交（#178:MERGED） |
| `claude/inspiring-mclaren-f76053` | `c70df4f41bc67aa508894d6826ec0b53265f4393` | 2026-07-03 | PR 已合并，合并后无新提交（#115:MERGED） |
| `claude/jovial-chebyshev-b15972` | `e5d9b577d07dbe19b5938396b9f84474deb3e590` | 2026-07-12 | 提交已在 main（#197:MERGED） |
| `claude/magical-bartik-bec68f` | `e2dacbbf65aed19216b7abdd81ad612f134fbb1d` | 2026-08-03 | PR 已合并，合并后无新提交（#306:MERGED） |
| `claude/qr-code-login-planning-8e5710` | `8e28d2ca3f6b287f700d2fe792285b905a95de25` | 2026-07-13 | 提交已在 main（#225:MERGED,#219:MERGED） |
| `claude/suspicious-lederberg-eef53b` | `fd25295e8925626822f885c47cf24f38908a4ca6` | 2026-07-03 | PR 已合并，合并后无新提交（#114:MERGED） |
| `codex/admin-credential-recovery-plan-20260715` | `8c038e06f67844f1c63659c887da68092b203506` | 2026-07-15 | 提交已在 main（#240:MERGED） |
| `codex/admin-initial-phone-binding-faa-reconcile-20260715` | `8dbbfe6dfe16c1306579e4e4bc445dc5a5ebb69c` | 2026-07-16 | 提交已在 main（#256:MERGED） |
| `codex/admin-initial-phone-binding-reconcile-20260715` | `2342bef4a37d5db3e3973a645922829006b5ea2f` | 2026-07-15 | 提交已在 main（#249:MERGED） |
| `codex/admin-initial-phone-binding-v2-20260715` | `2bcdf52b9cded44c8aaa058ce7f28413e0c81e5a` | 2026-07-15 | 提交已在 main（#244:MERGED） |
| `codex/admin-partner-phone-transfer-20260716` | `8537c15d5703c090c2877ae66374b1798c0f3fb9` | 2026-07-16 | PR 已合并，合并后无新提交（#266:MERGED） |
| `codex/admin-partner-warm-theme-governance-20260715` | `710f2bfb4d672721c2e5ddacb887c25854322b5a` | 2026-07-16 | 提交已在 main（#258:MERGED,#257:MERGED） |
| `codex/admin-password-security-20260715` | `03207df9d6b99c3614468f9e0fa77ddec0b10f46` | 2026-07-15 | 提交已在 main（#241:MERGED） |
| `codex/admin-phone-transfer-postmerge-status-20260716` | `de7830cd6b994aba3cdbf6202d999a0299cb3829` | 2026-07-17 | PR 已合并，合并后无新提交（#268:MERGED） |
| `codex/admin-phone-transfer-proof-state-guard-20260726` | `e4354b4322671130f1dd5d606f893f9c8294b170` | 2026-07-26 | PR 已合并，合并后无新提交（#393:MERGED） |
| `codex/ai-artifact-print-url-contract-20260711` | `9aeca889f01ea7755df555641ffc66f9143ab9a3` | 2026-07-11 | PR 已合并，合并后无新提交（#177:MERGED） |
| `codex/ai-resume-diagnosis-commercial-closure` | `aacb837b3a702a775b8631ec7be5fa57a671d365` | 2026-07-01 | PR 已合并，合并后无新提交（#110:MERGED） |
| `codex/b6-rebase-final` | `c3e1115ccab7bb52f8ce0e491990e3fc157c2dcb` | 2026-07-18 | PR 已合并，合并后无新提交（#301:MERGED） |
| `codex/c5-4-merge-status-20260712` | `8da7291f636d8ad87058ac87c9a08f133a16024f` | 2026-07-12 | 提交已在 main（#194:MERGED） |
| `codex/c5-4-redemption-settlement-consistency-20260712` | `397819097b6ceef682f17a78181c54b73c60ac90` | 2026-07-12 | 提交已在 main（#192:MERGED） |
| `codex/clean-candidate-freeze-gate-20260807` | `36f981b5d3c771472670c346081e7ab697d65256` | 2026-08-07 | 提交已在 main（#520:MERGED） |
| `codex/content-data-replacement-list-20260807` | `534a7d2943b70badc6105318080429a7100820b2` | 2026-08-07 | 提交已在 main（#528:MERGED） |
| `codex/contract-review-p0` | `62cbf22ea5252cda6bb82179fe4856f6261f0c85` | 2026-08-04 | 提交已在 main（#500:MERGED,#499:MERGED,#495:MERGED） |
| `codex/data-governance-audit-20260807` | `f20aa4832006139dd4e6aef2d6c93bed6b079323` | 2026-08-07 | 提交已在 main（#534:MERGED） |
| `codex/dependency-security-remediation-main-20260716` | `0b608b7c52126b0982249ae68ab726542ad3af79` | 2026-07-17 | PR 已合并，合并后无新提交（#271:MERGED） |
| `codex/deploy-admin-partner-frontends` | `58dfc3f04843462d4913db8f80d558e8510553b4` | 2026-08-07 | PR 已合并，合并后无新提交（#532:MERGED） |
| `codex/deploy-api-docs-20260807` | `209238b2c2ea623ad475f24c46af6e2dc4f932e4` | 2026-08-07 | 提交已在 main |
| `codex/deploy-api-same-commit-20260807` | `68ce8acc10dfad5ffaa58ebd0f9344bf4015d324` | 2026-08-07 | 提交已在 main（#519:MERGED） |
| `codex/deploy-api-workflow-20260807` | `4a0986f7103085be5fd6eca7799550f6b1827cef` | 2026-08-07 | 提交已在 main |
| `codex/deploy-frontend-fix-20260807` | `751da33ef6593f22bbc37a0ad888709edbea9d71` | 2026-08-07 | 提交已在 main（#529:MERGED） |
| `codex/deploy-home-filing-20260728` | `45f284fec0ef938e8e20c150d8ef8703c3e0bf22` | 2026-07-28 | PR 已合并，合并后无新提交（#424:MERGED） |
| `codex/deploy-outcome-progress-20260807` | `4b7a3efe1df16cf68cbef41ad788d478ae499dd6` | 2026-08-07 | 提交已在 main（#515:MERGED） |
| `codex/deploy-pin-ci-sha` | `9f242df51d9e76179efe54645cc24652106c88d9` | 2026-08-07 | PR 已合并，合并后无新提交（#537:MERGED） |
| `codex/deploy-release-record-20260807` | `05b827b241a11ddd67d2b15a86193cb9dece01a6` | 2026-08-07 | 提交已在 main（#525:MERGED） |
| `codex/device-fleet-f0-integration-20260715` | `a9f7c64d86b7503bf060bb33070ca35888fe8033` | 2026-07-15 | 提交已在 main（#245:MERGED） |
| `codex/docs-bootstrap-merge-20260807` | `477ea3f1894af79de8e193bccd77e6fcb53695a9` | 2026-08-07 | 提交已在 main（#516:MERGED） |
| `codex/docs-gate03b-merged` | `3467897f35bd5da27323693cd765bac29eb46a32` | 2026-07-26 | PR 已合并，合并后无新提交（#377:MERGED） |
| `codex/docs-preprod-printfileurl-no-print-acceptance-20260712` | `0a2cc4ac38d3e7785f4ccf63688b879ca2255967` | 2026-07-12 | 提交已在 main（#203:MERGED） |
| `codex/docs-progress-merge-status-20260714` | `880027a4096e22ea9104b2f7bc892400acaabb73` | 2026-07-14 | 提交已在 main（#233:MERGED） |
| `codex/f1-admin-credential-sync-main-20260715` | `f913aadea91976fc64b7fa46b6f4584081096d23` | 2026-07-15 | 提交已在 main（#252:MERGED） |
| `codex/f1-d2-cleanup-liveness-fixes-20260802` | `00f2c43f7d0183711b50d254ff23f34c33240a37` | 2026-08-02 | PR 已合并，合并后无新提交（#474:MERGED） |
| `codex/f1-d2-cleanup-merged-status-20260802` | `1a709480df5c9719ceafd6547aa3e6006b3e1022` | 2026-08-02 | PR 已合并，合并后无新提交（#478:MERGED） |
| `codex/f1-d2-cleanup-reconcile-20260801` | `085272b09b506193446458c8401eea125b1f0bc5` | 2026-08-01 | PR 已合并，合并后无新提交（#466:MERGED） |
| `codex/f1-d2-cleanup-reconcile-docs-20260801` | `4cafa5a3d5d2dc43d61220f35bef2b72b75f8faa` | 2026-08-01 | PR 已合并，合并后无新提交（#468:MERGED） |
| `codex/f1-d2-execution-contract-20260801` | `07ee39c075d7d581b6957b156911114d5f485dc9` | 2026-08-01 | 提交已在 main（#457:MERGED） |
| `codex/f1-d2-invocation-governance-reconcile-20260801` | `6de2df59f08f7b235612144c5cc4ac1ffc7d1afa` | 2026-08-01 | PR 已合并，合并后无新提交（#471:MERGED） |
| `codex/f1-d2-invocation-uniqueness-20260801` | `fd34dcba0b18113643915f00dbc95db266e96d2e` | 2026-08-01 | PR 已合并，合并后无新提交（#463:MERGED） |
| `codex/f1-d2-measure-diagnostics-20260731` | `065d7a455695cc07d107e970c567d86bd2ce4247` | 2026-08-01 | 提交已在 main（#452:MERGED） |
| `codex/f1-d2-post-latency-diagnostics-20260731` | `9b7c46463f3b15627509fbcba414e71c12aba561` | 2026-07-31 | PR 已合并，合并后无新提交（#451:MERGED） |
| `codex/f1-d2-pr471-docs-closure-20260801` | `8b4706a2590e27444ad0c663d3bca42330c4f955` | 2026-08-01 | PR 已合并，合并后无新提交（#472:MERGED） |
| `codex/f1-d2-prime-colima-drill-20260730` | `78d2b6df826f5f73b380abdf80b11db2905bf390` | 2026-07-30 | PR 已合并，合并后无新提交（#445:MERGED） |
| `codex/f1-d2-prime-colima-fresh-retake-20260730` | `5b692e4653c56a65d05754ab4399b0531fd00327` | 2026-07-30 | PR 已合并，合并后无新提交（#447:MERGED） |
| `codex/f1-d2-prime-fresh-retake-20260731` | `c11e697a571b9426f577c46bab42f4a1e6b69e08` | 2026-07-31 | PR 已合并，合并后无新提交（#450:MERGED） |
| `codex/f1-d2-prime-fresh-retake-result-20260801` | `63255192f6ce33085281f2b5adfe3f76f50788e3` | 2026-08-01 | 提交已在 main（#453:MERGED） |
| `codex/f1-d2-prime-pm2-isolation-fix-20260730` | `8339bbca9172c84a0a3e5864fb784eeeaf0bfefe` | 2026-07-30 | PR 已合并，合并后无新提交（#446:MERGED） |
| `codex/f1-d2-prime-retake-20260801` | `10139d7a1a7cfbf5e5d7a99cdcfd0f57fb154a1b` | 2026-08-01 | 提交已在 main（#454:MERGED） |
| `codex/f1-d2-prime-xdg-contract-fix-20260730` | `a0b8aadf639abece24511302014708032e5bcb4f` | 2026-07-31 | PR 已合并，合并后无新提交（#448:MERGED） |
| `codex/f1-d2-systemd-target-version-review-20260801` | `133a71140d4c5b12cbb74e3c209afd97988f90ef` | 2026-08-01 | PR 已合并，合并后无新提交（#469:MERGED） |
| `codex/f1-d3-runbook-inputs-20260730` | `50a9bcf46e32cb4376ac3baaffb70caa7d172a1f` | 2026-07-30 | PR 已合并，合并后无新提交（#441:MERGED） |
| `codex/f1-genesis-d1-offline-20260725` | `84f454b5dadf750f9434d179e3be7aba945cfc50` | 2026-07-25 | PR 已合并，合并后无新提交（#334:MERGED） |
| `codex/f1-provenance-ssot-correction-20260716` | `4a710982626bdcd1fe764f18c829f1b38315864f` | 2026-07-16 | 提交已在 main（#264:MERGED） |
| `codex/f1-release-provenance-main-20260716` | `b7a365dafb13dd14ecbd94aa78e0a018a9f390cc` | 2026-07-16 | 提交已在 main（#262:MERGED） |
| `codex/f1-same-host-dual-port-design-20260730` | `31781df78d340b267cf7dedb3320df87ae1675b7` | 2026-07-30 | 提交已在 main（#444:MERGED） |
| `codex/file-flow-field-checklist-20260807` | `335f224f089b424b720d9a9757474c690166dabf` | 2026-08-07 | PR 已合并，合并后无新提交（#523:MERGED） |
| `codex/first-admin-bootstrap-gate-20260807` | `bb501ca35e241ff6d5256dbd9a95f130976c0b89` | 2026-08-07 | 提交已在 main（#517:MERGED） |
| `codex/fix-admin-create-device-feedback` | `fba2efc17cd1e40b69e07494eb9c3b1fad8a37bb` | 2026-08-05 | 提交已在 main（#506:MERGED） |
| `codex/fix-contract-file-policy-flake-20260807` | `b1d1c0387b4cf217e26d578bba6aaba44f5498fd` | 2026-08-07 | 提交已在 main（#522:MERGED） |
| `codex/fix-kiosk-resume-filename-encoding-20260714` | `1b9a2b0a70285c29b6f457a550f7a60fc4d82c5c` | 2026-07-14 | 提交已在 main（#232:MERGED） |
| `codex/fix-main-ci-regressions` | `94e069440ba1706f76ca6c16a1e4763d28b7b802` | 2026-08-06 | 提交已在 main（#511:MERGED） |
| `codex/fix-ocr-live-render-20260712` | `fd11ff77385334767e0077702c5369a3d167724f` | 2026-07-12 | 提交已在 main（#201:MERGED） |
| `codex/fix-privacy-export-scope-copy-20260725` | `626a96a7483727f41ab3707056cc8f1f1f2e2434` | 2026-07-25 | PR 已合并，合并后无新提交（#329:MERGED） |
| `codex/fix-terminal-agent-form-data-20260714` | `d723144764f00faf94912ae4831919ea790e8b74` | 2026-07-14 | 提交已在 main（#238:MERGED） |
| `codex/fix-terminal-agent-service-identity-20260714` | `100de489853772cd66de0eaa4d80bb6377a7b2e2` | 2026-07-14 | 提交已在 main（#237:MERGED） |
| `codex/fix-terminal-ready-alert-20260714` | `6a458fa0de0f6d4bc90c637aba8aa7c8fb796bd9` | 2026-07-17 | 提交已在 main（#239:CLOSED） |
| `codex/foundation-batch0-20260717` | `1c97c8ac97d82158904249946806288dcfa03243` | 2026-07-17 | PR 已合并，合并后无新提交（#293:CLOSED,#289:MERGED） |
| `codex/free-mode-description-only-20260715` | `66462f7f5140c8f61f48197f18d0f51e0cadd3c5` | 2026-07-15 | PR 已合并，合并后无新提交（#255:MERGED） |
| `codex/g6-legal-consent-version-20260725` | `02b7c3adebdfd0a91ea72fed1bde0dd9c0ed87a5` | 2026-07-25 | PR 已合并，合并后无新提交（#343:MERGED） |
| `codex/gate0-agent-credential-hardening` | `437daa3767d0f763e4ced65d7ed455a511657fc9` | 2026-07-27 | PR 已合并，合并后无新提交（#406:MERGED） |
| `codex/gate0-device-credential-batch1` | `cf6a936718201d690c132bd0834446f48213d7ac` | 2026-07-25 | PR 已合并，合并后无新提交（#357:MERGED） |
| `codex/gate0-terminal-maintenance-drain` | `28eead3cc5aff6675d2127e1eae395410d9eecfe` | 2026-07-25 | PR 已合并，合并后无新提交（#375:MERGED） |
| `codex/gate0-terminal-retirement` | `5383144e65e5f58c229149c1ac05715b53c6c73f` | 2026-07-26 | PR 已合并，合并后无新提交（#376:MERGED） |
| `codex/gate04-diagnose-acl-20260727` | `9ad99bd2b4efd40ed784943e47e419afe3c89bec` | 2026-07-27 | PR 已合并，合并后无新提交（#401:MERGED） |
| `codex/gate04-harden-programdata-acl` | `cc7d1996699baa9dcdb2381c003b5d5ec87098ee` | 2026-07-27 | PR 已合并，合并后无新提交（#404:MERGED） |
| `codex/gate04-powershell51` | `2edb7440fcf995d8270f1de25300f71ab53f8805` | 2026-07-27 | PR 已合并，合并后无新提交（#409:MERGED） |
| `codex/gate04-ps51-file-replace-20260727` | `88f1c7948728d0a9a02389bac97ff20492add1b8` | 2026-07-27 | PR 已合并，合并后无新提交（#405:MERGED） |
| `codex/gate0k-smb-field-pack` | `455f1e46eba9de97c7ec30e76a7df3f93aa83d03` | 2026-07-27 | PR 已合并，合并后无新提交（#417:MERGED） |
| `codex/gate0k-usb-bridge-token` | `74f3b0991492e0c09200a4cd2dfb6867bd665987` | 2026-07-28 | PR 已合并，合并后无新提交（#423:MERGED,#419:MERGED） |
| `codex/global-refresh-mechanism` | `83b05bc70a3e8df62047b931f7ed3eb38da0607f` | 2026-06-29 | PR 已合并，合并后无新提交（#105:MERGED） |
| `codex/interview-batch4-20260717` | `6b970a2f987ee648f8f6d2bfce706aef2e780320` | 2026-07-18 | PR 已合并，合并后无新提交（#296:MERGED） |
| `codex/job-fit-m1-5-integration-20260712` | `015bcb2ae98051e8c6a80f0d69c837804e368206` | 2026-07-12 | 提交已在 main（#200:MERGED） |
| `codex/job-fit-m1-5-truth-docs-20260712` | `797ef49bfba6fa94202d123e1d7c51df13ea14e5` | 2026-07-12 | 提交已在 main（#207:MERGED） |
| `codex/jobs-fairs-batch5-20260717` | `1b3c93c0a7cd060a7adffdabb37857ea7e35f483` | 2026-07-18 | PR 已合并，合并后无新提交（#298:MERGED） |
| `codex/js-yaml-ci-unblock-20260807` | `161ac894aa9b08a43866bc5458b1bb451d6d82ba` | 2026-08-07 | 提交已在 main（#514:MERGED） |
| `codex/kiosk-8177-5299-fusion-design-20260723` | `ff478b8d4a97d53a4cb07bf68012b1c2f2da403e` | 2026-07-25 | PR 已合并，合并后无新提交（#325:MERGED） |
| `codex/kiosk-runtime-terminal-identity` | `02957cd3f9a2865e47e3afe7601b194ce81e1c17` | 2026-07-29 | PR 已合并，合并后无新提交（#420:MERGED） |
| `codex/kiosk-scan-ux-honesty-b1-20260727` | `fbb99f05b0c6776e62d7893362789014ee59f418` | 2026-07-27 | PR 已合并，合并后无新提交（#413:MERGED） |
| `codex/kiosk-stage-fit-20260726` | `8ef5af8be9919ded46ed0a3df91a92bf86de07d5` | 2026-07-26 | PR 已合并，合并后无新提交（#379:MERGED） |
| `codex/kiosk-visual-unification-20260725` | `60e969c60d73b8c943dd086507d89519979da861` | 2026-07-25 | PR 已合并，合并后无新提交（#328:MERGED） |
| `codex/loop-ci-gates-20260730` | `6907c94b2772e4c56f926f62c406416a6f8f8330` | 2026-07-30 | PR 已合并，合并后无新提交（#435:MERGED） |
| `codex/multihost-deployment-closure` | `677a2d6f03a555e0447d0744ff2efb7c08070fda` | 2026-07-29 | PR 已合并，合并后无新提交（#433:MERGED） |
| `codex/p0-1b-kiosk-session-warning-20260729` | `c38db6684ebceeeab832d97c2eb8c5ad7221a247` | 2026-07-30 | PR 已合并，合并后无新提交（#434:MERGED） |
| `codex/p0-1b-merge-docs-20260730` | `26ec888509d00cc9c5e07b5cfa911d5b91ef3840` | 2026-07-30 | PR 已合并，合并后无新提交（#436:MERGED） |
| `codex/p0-2-f1-d3-precheck-20260730` | `b7ef59e608b3855e64514c517bc5c83075c9e691` | 2026-07-30 | PR 已合并，合并后无新提交（#438:MERGED） |
| `codex/p0-2a-f1-d3-unblock-package-20260730` | `e3442c40477c129bfdbf2c337cb17143cef0279d` | 2026-07-30 | PR 已合并，合并后无新提交（#440:MERGED） |
| `codex/p0-demo-seed-guard` | `5a181b7781f8c75b622472104fac6de4dc70cbcc` | 2026-08-06 | 提交已在 main（#508:MERGED） |
| `codex/p0-first-admin-bootstrap` | `05c91679dcad40dc8e6d8ec0e91fc860e9cfdba3` | 2026-08-07 | 提交已在 main（#510:MERGED） |
| `codex/p0-kiosk-privacy-timeout-20260729` | `6c469a96f50b8e35629cf5a203ff04bb66380dd7` | 2026-07-29 | PR 已合并，合并后无新提交（#432:MERGED） |
| `codex/partner-account-dual-auth-removal-design-20260718` | `e1f755fd081ba74976d36021c34092d75a6bdc81` | 2026-07-19 | PR 已合并，合并后无新提交（#308:MERGED） |
| `codex/partner-account-member-safe-removal-20260716` | `f9e7233258b5de5e382c7e35af59719aaf4e015f` | 2026-07-16 | PR 已合并，合并后无新提交（#267:MERGED） |
| `codex/partner-account-phone-transfer-ux` | `c2dc21decb242ec349e8fbd2502a03261c58173d` | 2026-07-26 | PR 已合并，合并后无新提交（#391:MERGED） |
| `codex/partner-email-login-alias-20260725` | `63fb0c59537d196871e2187b2e58554caf4f4442` | 2026-07-25 | 提交已在 main（#356:MERGED） |
| `codex/partner-refresh-rollout` | `b74218a731a237c2df1f6a547e9f2290dacbf200` | 2026-06-29 | PR 已合并，合并后无新提交（#106:MERGED） |
| `codex/payment-auto-reconcile-20260713` | `8695f18494b924d84781c615346f1ae21403c937` | 2026-07-13 | 提交已在 main（#212:MERGED） |
| `codex/payment-auto-reconcile-live-acceptance-20260713` | `16693d83e6c5b44bb32f07530b363138e396ee0f` | 2026-07-13 | 提交已在 main（#215:MERGED） |
| `codex/peripheral-field-acceptance-20260807` | `65e3886fe99200fefcc3b2e55efba8459a9146a7` | 2026-08-07 | 提交已在 main（#536:MERGED） |
| `codex/phase0-s0a-truthfulness-20260728` | `ca8b483029fb66952071845c710b99ed7bd9df7a` | 2026-07-28 | PR 已合并，合并后无新提交（#426:MERGED） |
| `codex/phase0-s0b-merge-record-20260729` | `abdee3b525c14493e8e0bfeef161b430794c74f2` | 2026-07-29 | PR 已合并，合并后无新提交（#428:MERGED） |
| `codex/phase0-s0b-print-sim-truth-20260728` | `f0fb69bf35550d384f804925f8bf36355c374724` | 2026-07-29 | PR 已合并，合并后无新提交（#427:MERGED） |
| `codex/phase0-s0c-merge-record-20260729` | `18be42dde2de4ca04d60ad01bf409d3803505ecd` | 2026-07-29 | PR 已合并，合并后无新提交（#431:MERGED） |
| `codex/pr435-merge-status` | `f31ddbbfeff752aa8145fc70f47126ebcabf883e` | 2026-07-30 | PR 已合并，合并后无新提交（#437:MERGED） |
| `codex/preprod-payment-timeout-acceptance-20260713` | `ae144f49e28dc96bcfba7fe4df6d7c1cbde8e442` | 2026-07-13 | 提交已在 main（#220:MERGED） |
| `codex/preprod-seed-guard-deploy-evidence-20260712` | `56e585e60ae542791f69bf08b6373985a5bffebc` | 2026-07-12 | 提交已在 main（#202:MERGED） |
| `codex/preprod-seed-task-guard-20260712` | `536b56a849faf3ac23d06e8d7461965c485cf4d6` | 2026-07-12 | 提交已在 main（#198:MERGED） |
| `codex/print-scan-windows-acceptance-20260711` | `69fed4fcd6f4b8cbe0e40d8ab3fcd56f55d1e124` | 2026-07-11 | 提交已在 main |
| `codex/print-unpaid-task-controlled-cancellation-20260713` | `d69cad144a2f3b1fa205022f06e0828659e470b9` | 2026-07-13 | 提交已在 main（#223:MERGED） |
| `codex/prod-admin-password-readonly-audit-20260715` | `9b5d589c0993c5fd084ca9b939581188c854f8a8` | 2026-07-15 | 提交已在 main（#247:MERGED） |
| `codex/production-deployment-integrated-20260715` | `ef7aa4a07cd0b322b9dca2e15dc79debfdacce29` | 2026-07-15 | 提交已在 main（#242:MERGED） |
| `codex/production-p0-isolated-plan-20260712` | `9dd9187483397c2e586493c7385d02f0f67b4d6a` | 2026-07-12 | 提交已在 main（#209:MERGED） |
| `codex/profile-print-orders-inkpaper` | `00c274a61bb69182a222a2a7914c07eb03eca4d0` | 2026-07-04 | PR 已合并，合并后无新提交（#163:MERGED） |
| `codex/profile-print-orders-login-smoke` | `a193d82088dd2c48c878a34749d852ebb8707e96` | 2026-07-04 | PR 已合并，合并后无新提交（#166:MERGED） |
| `codex/qingxu-lightflow-integration-20260714` | `85d98ae3b5d09a16749a0ff6cc16d9c3c2c50309` | 2026-07-14 | 提交已在 main（#236:MERGED） |
| `codex/qingxu-lightflow-kiosk87-closure-20260726` | `457a9e930752965178dfe10b8ebc2181f3b27355` | 2026-07-27 | 提交已在 main（#400:MERGED,#392:MERGED） |
| `codex/qingxu-lightflow-ui01-first-batch-20260712` | `52e4236faad8fb5ae1764455e8f6edd75d6d15c6` | 2026-07-12 | 提交已在 main（#208:MERGED） |
| `codex/reconcile-wave1-account-security-merge-20260717` | `c1ca39634224d91c8c6078ae8934387c3efb6dc0` | 2026-07-17 | PR 已合并，合并后无新提交（#272:MERGED） |
| `codex/record-admin-phone-transfer-guard-deploy-20260726` | `3f0ece59059dae55032cf3bf80a587e7e9120c1e` | 2026-07-26 | PR 已合并，合并后无新提交（#394:MERGED） |
| `codex/record-dependency-security-merge-20260717` | `86e6af63838bb93122ba632b98903ac25eea76a7` | 2026-07-17 | PR 已合并，合并后无新提交（#273:MERGED） |
| `codex/record-fileflow-prod-deploy-20260807` | `3e1353eee7f9c8d62a7ee1b8ebfd56e6956731a0` | 2026-08-07 | PR 已合并，合并后无新提交（#531:MERGED） |
| `codex/record-full-api-deploy-20260726` | `59d54e79c11b76e7b4c3293f04befbb8dd6f6270` | 2026-07-26 | PR 已合并，合并后无新提交（#395:MERGED） |
| `codex/record-home-filing-deploy` | `f6fa5000d25b888c3eb95fd9b57f886bb3d85672` | 2026-07-28 | PR 已合并，合并后无新提交（#425:MERGED） |
| `codex/recover-service-hubs-commercial-candidate` | `9f001c57c91dd116a291a1029d633d8d7c70c70c` | 2026-08-06 | 提交已在 main（#504:MERGED） |
| `codex/release-reconcile-payment-safety-20260715` | `6787678d67c3dbb24221dd83c520c1c37069cdc9` | 2026-07-15 | 提交已在 main（#251:MERGED） |
| `codex/rescue-ai-resume-commercial-docs` | `0533b29b28175da7f2fedc229cf30a3f9aab6a20` | 2026-07-03 | PR 已合并，合并后无新提交（#119:MERGED） |
| `codex/resume-batch3-20260717` | `cde8afac15367eac6198209723f5114c6bde184b` | 2026-07-18 | PR 已合并，合并后无新提交（#295:MERGED） |
| `codex/resume-context-gate0-docs` | `53292d002e8c4c916a4767dae0b55fb19b96bdf5` | 2026-08-06 | 提交已在 main（#507:MERGED） |
| `codex/scan-input-health-slice1-20260715` | `0da8087cfe07a02ec7ce20eb17478123a0f12a24` | 2026-07-15 | 提交已在 main（#248:MERGED） |
| `codex/scan-upload-batch2-20260717` | `83d4ef9c346f536be0b5fa98be857bac03198819` | 2026-07-18 | PR 已合并，合并后无新提交（#292:MERGED） |
| `codex/sync-terminal-fleet-f0-merge-status-20260715` | `e7567a4b32d91bf32fe4defd211e79cb22c5aea5` | 2026-07-15 | 提交已在 main（#250:MERGED） |
| `codex/system-batch8-v2` | `b48632692186e2b2e86dc617acb9f4f5222df2b0` | 2026-07-18 | PR 已合并，合并后无新提交（#303:MERGED） |
| `codex/terminal-agent-config-doc-sync` | `9a4cc7d950f2ecdb44ace385f5fde773fb6726c1` | 2026-07-27 | PR 已合并，合并后无新提交（#416:MERGED） |
| `codex/terminal-agent-msi-b1` | `75de7963d75cb751b00289ce9e6f4299150c8382` | 2026-07-29 | PR 已合并，合并后无新提交（#422:MERGED） |
| `codex/terminal-agent-provisioning-complete` | `f178e2e48ca51af3cf4ae64e0e02fc941491b036` | 2026-07-29 | PR 已合并，合并后无新提交（#421:MERGED） |
| `codex/terminal-device-profile-closure` | `53b93747ffe34d41207cdb0fa9a69b5f6de9b5c3` | 2026-07-01 | PR 已合并，合并后无新提交（#109:MERGED） |
| `codex/terminal-network-diagnostics` | `9706ee7d98d09b9756d8d201a61337b5e84e1d5b` | 2026-07-30 | PR 已合并，合并后无新提交（#439:MERGED） |
| `codex/terminal-network-diagnostics-merge-record` | `e4bb32fbd63d75e7b91181aeb3eeca7927b76d27` | 2026-07-30 | PR 已合并，合并后无新提交（#442:MERGED） |
| `codex/update-kiosk-matrix-030506-20260807` | `39e9d675c5923cbddb7f787f97627cf8f3c98ea4` | 2026-08-07 | 提交已在 main（#526:MERGED） |
| `codex/user-center-commercial-closure-docs-20260716` | `c9f5a80c8bc2497fd6519e18eb034efc13a496be` | 2026-07-16 | 提交已在 main（#259:MERGED） |
| `codex/user-center-commercial-closure-plan-20260717` | `61a1951354f7624c816d8e0987f9b50bdb0ea0e9` | 2026-07-17 | PR 已合并，合并后无新提交（#279:MERGED） |
| `codex/user-center-plan-status-reconcile-r2-20260717` | `8e5c7f4b83dd0d9abfa6de623a9802390cf32c3d` | 2026-07-17 | PR 已合并，合并后无新提交（#274:MERGED） |
| `codex/user-center-postmerge-status-20260716` | `071594a8fcb5c5c0ba43967f1e8e5e5b9a65d41f` | 2026-07-16 | 提交已在 main（#260:MERGED） |
| `codex/user-center-wave0-data-truth-20260716` | `d5a7e34f7416b08db664ec62d84e2de1f3f2faf5` | 2026-07-16 | PR 已合并，合并后无新提交（#263:MERGED） |
| `codex/user-center-wave0-truth-baseline` | `3c719b0414f5f441ac852e224f08aa148a0d2bf9` | 2026-07-16 | 提交已在 main（#261:MERGED） |
| `codex/user-center-wave1-account-security-20260716` | `88e6aaa720db39e2e99d0b69ded9aae8479bf3b8` | 2026-07-17 | PR 已合并，合并后无新提交（#270:MERGED） |
| `codex/user-center-wave1-account-security-r2-20260716` | `0d05d16c5718dafe2a4fd20a5ea13a15ff2a8b1e` | 2026-07-16 | PR 已合并，合并后无新提交（#265:MERGED） |
| `codex/user-center-wave1b-reversible-data-rights-20260717` | `14b426b9574a372c52ea7af75136805a30e2c1fb` | 2026-07-17 | PR 已合并，合并后无新提交（#280:MERGED） |
| `codex/user-center-wave1b-slice1-20260717` | `06f37922603b031e6aff0d7331468b6f451e6bdb` | 2026-07-17 | PR 已合并，合并后无新提交（#275:MERGED） |
| `codex/user-center-wave1b-slice2-plan-20260717` | `743779d72e208f8d119f32d7301a3c50957f4346` | 2026-07-17 | PR 已合并，合并后无新提交（#276:MERGED） |
| `codex/windows-agent-reliability-p0-20260714` | `8c715ef119342388ba4e01ececc52a89d4a6d1b4` | 2026-07-14 | 提交已在 main（#234:MERGED） |
| `codex/windows-field-runsheet-20260807` | `849ed683080f22fb26fac92a2e6420d856027548` | 2026-08-07 | 提交已在 main（#527:MERGED） |
| `docs/462-cleanup-contract-truth` | `787ca452881fe236445d9920b847f21dbebe12f7` | 2026-08-01 | PR 已合并，合并后无新提交（#462:MERGED） |
| `docs/admin-phase-r-browser-20260725` | `7377a803edc13c780e846ded5762adabc1f36f16` | 2026-07-25 | PR 已合并，合并后无新提交（#364:MERGED） |
| `docs/b1-413-preprod-deploy-record` | `38daa8296312529b45a8530d7e6ea22909359649` | 2026-07-27 | PR 已合并，合并后无新提交（#415:MERGED） |
| `docs/checklist-seed-creds-gate3-rerun` | `f5bbbdbe40f354ef1892fc12d743aeb50a4091e8` | 2026-07-12 | 提交已在 main（#193:MERGED） |
| `docs/cloud-upload-phone-upload-consolidation` | `20b22c633ae6fe6b1c9e8b2e9430c67dffc986bf` | 2026-07-13 | 提交已在 main（#229:MERGED） |
| `docs/commercial-plan-2026-07-rescue` | `d8ded7843911360e662c8d619ce8452559e6c85c` | 2026-07-03 | PR 已合并，合并后无新提交（#118:MERGED） |
| `docs/console-redesign-analysis-2026-07-31` | `04a65dd11357882006c5b94abfcfe9a50f4b89bc` | 2026-08-02 | PR 已合并，合并后无新提交（#455:MERGED） |
| `docs/d2-cleanup-contract-merged` | `7be388a703648ad0e2f58da87e1b7cb16499c983` | 2026-08-01 | PR 已合并，合并后无新提交（#465:MERGED） |
| `docs/d2-env-probe-systemd-pin-20260801` | `416d505a090d31c6d5a68956c430fa18835fb063` | 2026-08-01 | PR 已合并，合并后无新提交（#467:MERGED） |
| `docs/d4-session-b-privacy-revoke-20260725` | `7f99ad5e6d55d819727e50950ef40b753148fb6a` | 2026-07-25 | PR 已合并，合并后无新提交（#341:MERGED） |
| `docs/f4-reprint-passed-20260726` | `d091359fe80f9af2be6e79c132277cae3a5420b4` | 2026-07-26 | PR 已合并，合并后无新提交（#378:MERGED） |
| `docs/fix-progress-conflict-markers-20260725` | `e7d9d4d0d7fdb385f85cdec146883e76b85ff932` | 2026-07-25 | PR 已合并，合并后无新提交（#347:MERGED） |
| `docs/fix-ssot-conflict-markers-20260726b` | `15f790dbc3d75c21f22a898eccd48ef9851485b5` | 2026-07-26 | 提交已在 main |
| `docs/fix-ssot-markers-urgent` | `15f790dbc3d75c21f22a898eccd48ef9851485b5` | 2026-07-26 | 提交已在 main |
| `docs/fix-ssot-markers-urgent2` | `f293a36bab9c4c514885c641c4fcaf8784f60f19` | 2026-07-26 | PR 已合并，合并后无新提交（#389:MERGED） |
| `docs/g6-preprod-deploy-20260725` | `50c047c2fe89cca24cd9320823dd2737f854de1a` | 2026-07-25 | PR 已合并，合并后无新提交（#348:MERGED） |
| `docs/gate04-384-progress-ssot` | `0ef8be3cb2d05aaf01282f8f7b76192aabe323bd` | 2026-07-26 | PR 已合并，合并后无新提交（#390:MERGED） |
| `docs/gate04-401-merged-note` | `3360a8a6eb696e2460031ae7fc419b170e272eb0` | 2026-07-27 | PR 已合并，合并后无新提交（#402:MERGED） |
| `docs/gate0k-smb-field-pass` | `2948e80e5b89664db8d3fc5284af363adc0286dd` | 2026-07-27 | PR 已合并，合并后无新提交（#418:MERGED） |
| `docs/kiosk-stage-fit-hotfix-20260726` | `3b27bda0ba45c9cef4c06013f6676931341a9833` | 2026-07-26 | PR 已合并，合并后无新提交（#387:MERGED） |
| `docs/material-pack-design` | `14e4298e758243f2dc5014862bc5188874e6912e` | 2026-07-12 | 提交已在 main（#204:MERGED） |
| `docs/next-tasks-non-f1-audit-2026-08-01` | `26e654ec4bde86ac9752e597219f62e57d71834c` | 2026-08-01 | PR 已合并，合并后无新提交（#459:MERGED） |
| `docs/p0-remote-inventory-20260725` | `b08ddfe9b2c36dc20ac63e0cae15b40dc5cefd54` | 2026-07-25 | PR 已合并，合并后无新提交（#350:MERGED） |
| `docs/p0-ssot-f4-and-0924-deploy-20260725` | `cbfebb488b8ca9eff3fdb7b79361f324d76d61c7` | 2026-07-25 | PR 已合并，合并后无新提交（#374:MERGED） |
| `docs/partner-342-browser-smoke-20260725` | `faa4520f81c6fdf23969246049b08e5500d4aca7` | 2026-07-25 | PR 已合并，合并后无新提交（#346:MERGED） |
| `docs/partner-342-logged-in-smoke-20260725` | `c4a53cedf1d3c2486700cb9efc850423f8fc78ed` | 2026-08-03 | PR 已合并，合并后无新提交（#349:MERGED） |
| `docs/partner-admin-smoke-20260725` | `4033bd70e40ac012f3c9a6a4ad72527af437acd8` | 2026-07-25 | PR 已合并，合并后无新提交（#358:MERGED） |
| `docs/post-328-progress-ssot-20260725` | `73fc3fe68f47824d44c05bf6ef9f32fb33837ab5` | 2026-07-25 | PR 已合并，合并后无新提交（#336:MERGED） |
| `docs/pr230-closure-record-v2` | `18542708f2603c5d9af0689f7033ac48ffab60c7` | 2026-07-17 | PR 已合并，合并后无新提交（#281:MERGED） |
| `docs/preprod-deploy-0924a09b-20260725` | `f457869d7750e8bfde1a76b1909089f37a8f7a84` | 2026-07-25 | PR 已合并，合并后无新提交（#370:MERGED） |
| `docs/preprod-deploy-83f-ssot` | `7ef920e4bfda823e83b6536c47952dca54e67d51` | 2026-07-26 | PR 已合并，合并后无新提交（#385:MERGED,#382:CLOSED） |
| `docs/preprod-deploy-83f2117f-20260726` | `69faedb0edcb82a6a44efd14fb0e61c8b6e72198` | 2026-07-26 | PR 已合并，合并后无新提交（#381:MERGED） |
| `docs/preprod-legacy-pending-disposition-20260712` | `a1ce19b9ec930c2763460f8729a8b6af7c09b46b` | 2026-07-12 | PR 已合并，合并后无新提交（#189:MERGED） |
| `docs/printfileurl-preprod-audit-20260712` | `4b61983193024f5eb2e35dbae041483a80df5581` | 2026-07-12 | PR 已合并，合并后无新提交（#199:MERGED） |
| `docs/record-pr230-superseded-by-pr241` | `6a458fa0de0f6d4bc90c637aba8aa7c8fb796bd9` | 2026-07-17 | 提交已在 main（#243:CLOSED） |
| `docs/rescue-ia-toolbox-records` | `d26dec31a9d5fa716f068ac637a41da2c53ce4a3` | 2026-07-03 | PR 已合并，合并后无新提交（#120:MERGED） |
| `docs/resume-print-369-ssot` | `92dbf26c99b6b4affd315587d1c694e5d32cb6be` | 2026-07-25 | PR 已合并，合并后无新提交（#373:MERGED） |
| `docs/secrets-evidence-wait-20260725` | `57195b853141cc126897c16739a08ce34231252b` | 2026-07-25 | PR 已合并，合并后无新提交（#359:MERGED） |
| `docs/secrets-rotation-evidence-c-20260725` | `b5f83b2f4b3772be5a4708e4a0dbacebb3d5e969` | 2026-07-25 | PR 已合并，合并后无新提交（#362:MERGED） |
| `docs/seed-password-confirm-20260725` | `8bec9d4085499b1672c882421afbfbf8ec251089` | 2026-07-25 | PR 已合并，合并后无新提交（#353:MERGED） |
| `docs/seed-password-rotate-20260725` | `d573ee904fb2b26047855051facda76dc9a55ea0` | 2026-07-25 | PR 已合并，合并后无新提交（#354:MERGED） |
| `docs/sms-e2e-passed-20260726` | `1313915b480163bdfea2bad5561e62a10da73843` | 2026-07-26 | PR 已合并，合并后无新提交（#380:MERGED） |
| `docs/trust-proxy-preprod-deploy-20260725` | `9195015320128b118412398322737730fbfae8ef` | 2026-07-25 | PR 已合并，合并后无新提交（#337:MERGED） |
| `docs/user-center-plan-reconcile-final` | `128c9e34b8f64bed94e8cd229e6fc9ec7f8119f8` | 2026-07-17 | PR 已合并，合并后无新提交（#286:MERGED） |
| `docs/windows-field-phase-f-20260725` | `f00117590c6ebcc8f04a1b97edda50029a69c13b` | 2026-07-25 | PR 已合并，合并后无新提交（#363:MERGED） |
| `docs/windows-field-phase-f-receipt-20260725` | `87dbb94960e4bbfdc210b3246dab516c83e903f6` | 2026-07-25 | PR 已合并，合并后无新提交（#365:MERGED） |
| `feat/print-core-batch1-clean` | `237a717c7e161c4bc390a3f80e121c5dc7548f21` | 2026-07-18 | PR 已合并，合并后无新提交（#291:MERGED） |
| `feat/visual-align-20260717` | `3714e0c6a43d175879ded1fd84e780a488e43ad2` | 2026-07-19 | PR 已合并，合并后无新提交（#307:MERGED） |
| `feature/admin-pending-print-dispose` | `90d6d0a6388e9021ace67d93b7adbab657688902` | 2026-07-19 | PR 已合并，合并后无新提交（#319:MERGED,#317:MERGED） |
| `feature/ai-cost-log-coverage` | `8bc167027268bb0e86bbc0e73941cd2a65a555aa` | 2026-08-01 | PR 已合并，合并后无新提交（#456:MERGED） |
| `feature/format-conversion-images-to-pdf` | `40cfb283f6c6286cd7148d2c7ad3e258dcb42d9d` | 2026-07-12 | 提交已在 main（#180:MERGED） |
| `feature/g1-offline-agencies-20260717` | `ea3e2d1053651bdcb379746f27798991bbf9b1db` | 2026-07-18 | PR 已合并，合并后无新提交（#305:MERGED） |
| `feature/g5-admin-refund-entry` | `eee892923952eb783284ff1451c7effff3b50aa2` | 2026-07-19 | PR 已合并，合并后无新提交（#311:MERGED） |
| `feature/g6-legal-doc-version` | `33497df1a25f4c2aa99bb70c4b144317320ec479` | 2026-07-19 | PR 已合并，合并后无新提交（#310:MERGED） |
| `feature/payment-wechat-refund-notify` | `46a41d3a0b11103bcdfc796aaec43200f374cc6d` | 2026-07-06 | PR 已合并，合并后无新提交（#175:MERGED） |
| `feature/print-pickup-claim` | `8f6dead9091d6fa336d3f3cae4f45e56a09bd315` | 2026-08-04 | PR 已合并，合并后无新提交（#491:MERGED） |
| `feature/print-scan-acceptance-gates` | `f8b2d9aae7b694a9dabeb3cc4e963a58c91058f6` | 2026-07-12 | PR 已合并，合并后无新提交（#191:MERGED） |
| `feature/print-scan-admin-ops` | `7d4cdc535f25f4a11ee43b732f1356a5e515aef6` | 2026-07-11 | PR 已合并，合并后无新提交（#181:MERGED） |
| `feature/resume-optimize-wave6a-format-conversion` | `1ac6cf5664038c83463971e837fb26e7b3686df1` | 2026-07-14 | 提交已在 main（#231:MERGED） |
| `feature/scan-session-hardening-b1` | `e4560097d2022a7137a257bac14910a63c24a4b4` | 2026-07-14 | 提交已在 main（#235:MERGED） |
| `feature/screens-6061-session-offline` | `8cebbd9609cb54f7e862afaed8851763a4ef66a8` | 2026-07-19 | PR 已合并，合并后无新提交（#312:MERGED） |
| `feature/sign-stamp-design` | `f018a9d1822d85f39457bddbcd8c45edeff5cad9` | 2026-07-13 | 提交已在 main（#222:MERGED） |
| `feature/wave1b-data-rights-executor` | `08a258c3337462d13838b2039ba7959d41f3d068` | 2026-07-19 | PR 已合并，合并后无新提交（#314:MERGED） |
| `feature/wave1b-export-execution` | `a7aed13f7bb22c08e0f36a1331f7532772555dcd` | 2026-07-19 | 提交已在 main |
| `feature/wave1c-admin-privacy-ui` | `9675b5fe4656d5c459ff38d34c90b6077687e101` | 2026-07-19 | PR 已合并，合并后无新提交（#313:MERGED） |
| `feature/wave2-account-rebind` | `f31107a4d1cf40ea785ea7066da2ed29f54c2077` | 2026-07-19 | PR 已合并，合并后无新提交（#321:MERGED） |
| `feature/wave3-print-aftercare` | `2669ffcba9174193f4771bf6c08caf63bd7c494e` | 2026-07-19 | PR 已合并，合并后无新提交（#322:MERGED） |
| `feature/wx-miniapp-login` | `271075f798e47022483629c8f37756b90293f844` | 2026-08-02 | PR 已合并，合并后无新提交（#485:MERGED） |
| `fix/ci-home-contract-drift-20260804` | `9c4d128c762b4c9ddf598c3b933e73f4d45b3034` | 2026-08-04 | PR 已合并，合并后无新提交（#497:MERGED） |
| `fix/ci-restore-pg-wxopenid-and-w6-route` | `7dfa9cd9d2ca49d3e72381669d8fa1d048878f3a` | 2026-08-03 | PR 已合并，合并后无新提交（#489:MERGED） |
| `fix/ci-three-failures-20260804` | `af73f317c174b549d320cef028b372def6ce4e75` | 2026-08-04 | PR 已合并，合并后无新提交（#501:MERGED） |
| `fix/d2-cleanup-not-found-contract` | `8e1e16786aea1004c3d356d5c978e35b12e4e4c5` | 2026-08-01 | PR 已合并，合并后无新提交（#464:MERGED） |
| `fix/deepseek-v4-model-20260725` | `02122d791c98f49f4fd2c874251e29d7130b8d5b` | 2026-08-02 | PR 已合并，合并后无新提交（#368:MERGED） |
| `fix/drill-stale-pid` | `c5325831525432407d1f9dfef38e08646437898f` | 2026-08-01 | PR 已合并，合并后无新提交（#460:MERGED） |
| `fix/g1-offline-agencies-verify-drift-20260802` | `6ae2009d8589860a8d0907fa9b9bc7776e446064` | 2026-08-02 | PR 已合并，合并后无新提交（#487:MERGED） |
| `fix/g1-second-pass-p1-20260803` | `7de15d6eb771b5650a7dd820bef9d8cc18bdca1b` | 2026-08-03 | 提交已在 main（#494:MERGED） |
| `fix/homepage-entry-audit-cleanup-20260711` | `717bf3dc996a7589c7c7fbd6b4c95dee20e9b631` | 2026-07-12 | 提交已在 main（#182:MERGED） |
| `fix/p0-multiinstance-security` | `e56d6935e31859bb4d0458a1a12e1e5977a35f96` | 2026-08-02 | PR 已合并，合并后无新提交（#490:MERGED,#479:MERGED） |
| `fix/p1-dep-remediation-20260725` | `96b3d8c1acf0a53c35ba376abe61b7d46a5d8fba` | 2026-07-25 | PR 已合并，合并后无新提交（#355:MERGED） |
| `fix/partner-relative-api-url-20260725` | `ba9e7f1feb13d3721b7b6ace393b404ff6f1d0b0` | 2026-07-25 | PR 已合并，合并后无新提交（#342:MERGED） |
| `fix/preprod-hotfixes-20260725` | `2134740a74fb2ec56bdb28152201f5a9b76fe3b1` | 2026-07-25 | PR 已合并，合并后无新提交（#366:MERGED） |
| `fix/print-scan-query-race` | `1b46af007fb12897ae1041f03bacaebfed75cc8b` | 2026-07-17 | PR 已合并，合并后无新提交（#287:MERGED） |
| `fix/printer-heartbeat-v3` | `6ee777e645f1dee24f2cbaf80a0e11b4b9386392` | 2026-07-17 | PR 已合并，合并后无新提交（#284:MERGED） |
| `fix/resume-print-upload-channels-20260725` | `cc0eaa9b1ea2e211c2fdb5d2d089d9032f988c85` | 2026-07-25 | PR 已合并，合并后无新提交（#369:MERGED） |
| `fix/toolbox-default-contract-review` | `f0f9cbf49b217938f46d551660dc9bf411a28e69` | 2026-08-04 | 提交已在 main（#502:MERGED） |
| `refactor/n1-jobs-service-split` | `2498c154dda9d88214bdcd865d9c2e1838b3b544` | 2026-07-19 | PR 已合并，合并后无新提交（#318:MERGED） |
| `refactor/n3-terminals-service-split` | `401a83c27b54b067b888e982eddbec239bcd83f7` | 2026-07-19 | PR 已合并，合并后无新提交（#320:MERGED,#316:MERGED） |
| `refactor/n56-service-split` | `9b389d03a605bfeda5ed1dcf4fc7e8b02ffaab5e` | 2026-07-19 | PR 已合并，合并后无新提交（#315:MERGED） |

## 第二批（2026-09-25 夜，75 个）

Grok 对剩下 102 个逐个比对两个基线（`origin/main@eb0f20341`、整合分支 `0f415cf65`）：独有提交按补丁等价，或改动过的文件与基线字节相同、或该字节曾原样出现在基线历史里又被后续版本取代，判删；有未被吸收、可能有价值的改动判保留。Claude 抽查 7 个成立（含近 14 天仍有推送的 2 个）；17 个「需要看」由 Claude 提建议、Agy 复核一致：删 3、保留 14。产品负责人授权按推荐执行。删除同样带「远程提交号未变」保护，零拒绝；远程分支 109 → 34。

| 分支 | 最新提交 | 日期 | 依据 |
| --- | --- | --- | --- |
| `claude/admin-account-settings-6ee9e8` | `e8c3a42bcb740e453f159d1cff2c408b741fcdfc` | 2026-07-14 | 管理员改密已在基线（账号设置页和 verify:change-password 都在） |
| `claude/docs-stale-facts-fix-round2-20260818` | `f908398773c8ecc586d4d41877b30eeb376c017b` | 2026-08-18 | 基线那份审查稿里已经没有「端点不存在」的误判句 |
| `claude/epic-feistel-b5f30a` | `bf37b9d3c1cd4af2cd601031b69f6a51b13ea205` | 2026-08-06 | 文件清理在基线已是 files.cleanup.task，本分支是另一套旧服务 |
| `claude/jovial-bassi-53427d` | `733d3df6ce4436ddaf7783920db1ddaf045df679` | 2026-07-03 | 失败原因回显 failureReasonForUser 已在基线 |
| `claude/lucid-kilby-0199ed` | `9a10b9e97a613c73810b8c6f258dbf0bf8d62c45` | 2026-07-19 | 合并后只剩进度勾选，对应 PR 已在 main，表述已被后续任务单取代 |
| `claude/project-readiness-review-959ffe` | `61fd5b093739a38cf0c31f71c5828de6287d3d94` | 2026-09-03 | 51 页青序原型基线已有 99 个文件，本分支是更早的 84 文件快照 |
| `claude/qx-b3-fairs` | `64a6e6591589bc2459c12206f01066fdcbc93d23` | 2026-09-10 | 招聘会青序页已在整合分支改成 QxFairWorkbench，「筛选筛空」也在 |
| `codex/admin-initial-phone-binding-production-release-20260715` | `b65cd17c960f235b0686b3b5147380716a8f0395` | 2026-07-15 | Admin 首次绑手机号服务已在基线 |
| `codex/campus-companies-batch6-20260717` | `5e45fd13651df7338264026a2ef6b60514923718` | 2026-07-18 | 只剩已完成事项的进度记 |
| `codex/deploy-ci-unblock-20260806` | `75b161061afc939ed74dc7b87ace6767a6be1e53` | 2026-08-07 | 2026-08 的 CI 解阻旧稿，main 后来已经收口 |
| `codex/docs-printfileurl-status-correction-20260712` | `52e6581828619b1b38936939142f2affccb0315f` | 2026-07-12 | 只记录已经合入的 printFileUrl 修复 |
| `codex/f1-d2-prime-main-integration-20260731` | `c87349c8648d188829778d544e87bf2ac96c5571` | 2026-07-31 | d2 同机演练脚本已在 main，这次整合已被商业整合分支取代 |
| `codex/file-cleanup-cas-20260811` | `038c147abcbee65b33a9d2c59cbbb5ff42b4462b` | 2026-08-11 | 清理防旧候选基线已有 cleanupStale；删除重试迁移留在 storage-delete-retry |
| `codex/file-flow-main-integration` | `841395228a66662bbe3d35faa3fdf46d85ce8b44` | 2026-08-06 | 旧的主线整合，打印扫描页面基线已经继续改过 |
| `codex/fix-agent-image-jobname-20260813` | `8a3ac546e3210309ce12173729e6717ff16205d5` | 2026-08-14 | 安装器升级校验基线已有，没有留下独立的作业名修复 |
| `codex/fix-js-yaml-advisory-20260807` | `ed31557ec3c529009f7f4f566c1305c82ee3fa73` | 2026-08-07 | js-yaml 公告修复已在基线 |
| `codex/gate04-agent-acl-no-cli-token` | `0d93c38cf9c862d9dace38d443445058a0652e14` | 2026-07-26 | 合并后只剩 Gate 0.4 进度记，安装脚本改动已在基线 |
| `codex/gate0k-scan-usb-prep-20260727` | `22d1ab79fb364e6a1d90c73fc8a7bce22ee81bbe` | 2026-07-27 | 合并后只剩 7 月扫描/U 盘进度，现场状态已被后续文档取代 |
| `codex/kiosk-filing-hotfix-20260901` | `6b4a92f56c26ac058a073f8c6dbeb3a390a5bff8` | 2026-09-01 | 备案页脚改在已下线的 V6 首页上，基线已有首页备案字样 |
| `codex/kiosk-w16-w22-visual-closeout-20260725` | `7da74dfb702851e93b9671c21460918cb04d6ddd` | 2026-07-25 | 7 月视觉收口，已被青序流光取代 |
| `codex/legacy-pending-print-task-disposition-20260711` | `2f762c5fc4da32876823b697d227fb3acff3622e` | 2026-07-11 | 独有提交的显著行已在 main 或整合分支 |
| `codex/legal-doc-publish-20260810` | `d0c10c6fdddb4559d2d5453b5bf27824441c9f43` | 2026-08-10 | 法律页已在基线，剩下是旧样式和进度记 |
| `codex/me-account-batch7-20260717` | `4d5ad50ee900927f64d2a4a2931a953a0b2426e9` | 2026-07-18 | 我的账号旧视觉批次，设置页已有后续版本 |
| `codex/me-account-batch7-final` | `1d1fe42cead386dfa361fc0ce523fb31f596a7ec` | 2026-07-18 | 同上，账号页旧视觉，已被后续版本取代 |
| `codex/me-account-batch7-v2` | `3e6dc6b939c0df526077646bec802ddc0220e453` | 2026-07-18 | 同上，账号页旧视觉，已被后续版本取代 |
| `codex/miniapp-m2-first-slice` | `703d4ceebd7172e1fc40b3cb75e523cd6698b01d` | 2026-08-12 | PrintService 完成确认已在基线（queryCompletionEvent），剩余是旧进度句 |
| `codex/package-order-idempotency-r12-20260917` | `d9d79f2689dddd0614a76b71a2252a96d7468a69` | 2026-09-17 | 套餐下单幂等已在整合分支，只剩收口进度记 |
| `codex/phase0-s0c-resume-parse-truth-20260729` | `959976c46a96d9b03c121049d0a8878abebebbd1` | 2026-07-29 | git cherry 对两个基线都没有独有提交 |
| `codex/print-core-batch1-20260717` | `89f1944f760ea8a4405d495f8bf5b958c6335e7e` | 2026-07-18 | 打印核心第一批旧稿，后续打印域已在基线 |
| `codex/print-first-order-evidence-20260807` | `b38f7036af3f39c200a97d042ce67db35469dad7` | 2026-08-07 | 只剩进度记 |
| `codex/print-scan-admin-ops-review-fixes-20260712` | `22ca94137c16561246c5d09446204dcc29812940` | 2026-07-12 | 7 月评审修补，订单只读后台已在基线 |
| `codex/print-scan-physical-proof-docs` | `6ae4865510e9ccdf1647c11a8171f90bc425c63e` | 2026-07-14 | 7 月实物验收草稿，后续已有真机出纸证据 |
| `codex/print-scan-windows-acceptance` | `267608a287a59b0cd61f6a012629b21bb37a8429` | 2026-07-06 | 7 月 Windows 验收准备，已被后续现场记录取代 |
| `codex/profile-commercial-p0a-payment-foundation` | `65d8cac7b76d631291cb2d55937761ff5e7b1a5f` | 2026-07-03 | 支付地基旧分支，没有留下独立代码 |
| `codex/recruitment-wave2-prod-admission-20260810` | `0b14f131f54e616c1feda52654a1fbb8310f0b53` | 2026-08-10 | 只剩基线已有的准入脚本差异 |
| `codex/release-auth-payment-preserving-20260715` | `ebe34fcca500fb85e8da0e46e779014b29c010f6` | 2026-07-15 | 只剩进度记 |
| `codex/release-base-6c2a9668` | `298c20ada80fc48a50f2f9dc63e080baf06d3b4e` | 2026-07-16 | 独有文件字节曾在基线历史里，已被后续版本取代 |
| `codex/release-strict-scan-health-20260715` | `3ba8e653350d13ca0c27da9c467d0631faba6a09` | 2026-07-15 | git cherry 对两个基线都没有独有提交 |
| `codex/smart-campus-visible-locked-20260811` | `713ad42d05ba0147201d94698f3ed5cd79a01412` | 2026-08-11 | 改的是旧首页，且与已定「本机没开通就不出现」相反（三方同意删） |
| `codex/system-batch8-20260717` | `e319c976fbea1e623e9e446e640d135ea6f20241` | 2026-07-18 | 7 月系统批次旧稿，对应页面基线已有后续版 |
| `codex/terminal-agent-runtime-packaging` | `49a132781298c1f72bae5d8ee00141c4f5cdf7c5` | 2026-07-27 | 配置改到 ProgramData 的做法基线里已经大量存在 |
| `codex/user-center-plan-status-reconcile-20260716` | `3dd0bba65bfddc222a8761b9cb709f44b548885a` | 2026-07-17 | 用户中心计划对账的文字基线已有 |
| `codex/v3-local-snapshot-20260811` | `2ffa2fad158593acb826184ac300b2704a208bde` | 2026-08-11 | 只剩进度记 |
| `codex/v3-production-gate0-20260811` | `7559430f5bf84e7fe3d05a5e3bde282c2be21ae1` | 2026-08-11 | V3 事实重述，设计文件基线已有后续版 |
| `codex/windows-acceptance-candidate` | `4ae91fc106af2ae0370d6f4e3b47f7c11e940068` | 2026-06-30 | 6 月验收候选，已被后续 Windows 证据取代 |
| `codex/windows-agent-0-4-1-provisioning` | `37545691107b58d518a66f0129a9268fd540458f` | 2026-08-13 | 0.4.1 供应旧线；升级测试已在基线，在线更新另有保留分支 |
| `codex/windows-agent-local-panel-20260810` | `28c9202dcc57a6ad8f98f7de9e29ffcfb53738da` | 2026-08-10 | 没有留下独立面板文件，安装器校验基线已有另一版 |
| `codex/windows-agent-upgrade-0-3-2-20260810` | `1d932ddaec6039a07b661c16ea2d98d0a9f167df` | 2026-08-10 | 0.3.2 升级旧线，生命周期测试已在基线 |
| `codex/windows-agent-upgrade-20260810` | `85842e36b723be1f58681cfdeac3365bb715ce41` | 2026-08-10 | 同日的升级旧线，生命周期测试已在基线 |
| `codex/windows-pantum-field-readiness-r3-20260917` | `792a9f987af84a795431747248e546bf2f1abbb6` | 2026-09-17 | git cherry 对两个基线都没有独有提交 |
| `docs/f4-physical-print-pass-20260725` | `34e8a23148e767bfe84d0be3c054961a7075eddb` | 2026-07-25 | 只剩 F4 出纸进度，后续文档已覆盖 |
| `docs/fix-7c-ssot-f4-next-20260725` | `ade7d56a6bf64eca057425f9af03afca4d3075c6` | 2026-07-25 | 只剩 7c 进度纠偏 |
| `docs/fix-overclaim-usb-disclaimer-20260726` | `62b2931dfe68981aef72da9e997d66ebf3da3b30` | 2026-07-26 | 只剩进度记，U 盘免责正文不在独有差异里 |
| `docs/gate04-field-ready` | `97377bf0c23bf125319d8cf21adb4ba03f282a6d` | 2026-07-27 | 恢复步骤所在的 onboarding 文档已在基线，分支是旧表述 |
| `docs/kiosk-ai-os-v3-baseline` | `931066146e8b61cffae574f58f4e7b411997ff54` | 2026-08-09 | V3 审计稿基线已有；缺的台账属于已被青序取代的旧设计 |
| `docs/p1-dep-audit-20260725` | `1552e07db84c9c3d8457e32676aa4162f2d3c2c1` | 2026-07-25 | 依赖审计文件已在基线 |
| `docs/partner-342-hotswap-20260725` | `ee0109a49df38c3a09c98374c915d039f1a95d6d` | 2026-07-25 | 合并后只剩一行已合入说明 |
| `docs/preprod-deploy-83f2117f` | `d69ff5db37b92376dffd549bf6a7ce5f827717dc` | 2026-07-26 | 只剩预发部署进度 |
| `docs/user-center-plan-reconcile-v2` | `e2ae2c553d66f8855aa41d77d827401c4ff1ed16` | 2026-07-17 | 对账文字基线已有 |
| `feat/kiosk-home-v3-pilot` | `e449614d2d59abffa333d62a8cfeae9edaf0800e` | 2026-08-09 | 首页 V3 试点已被 2026-09-03 青序流光裁决取代 |
| `feat/member-print-orders-failure-reason` | `b9bf81af6074b9631cfdcdf05b62c1ff8b83c093` | 2026-07-17 | 失败原因回显已在基线 |
| `feat/qx-service-hubs` | `fd8818e38c27c7de900ba29cbf80af5ee0edca9c` | 2026-09-10 | 五个服务台页 QxServiceHubPage 已在整合分支 |
| `feat/session-impact-domain-gate` | `9ced008c4785ddec5f71e3ffda32d4a1775a866f` | 2026-09-09 | 提交说明写明暂不合入，只留下未启用的测试 |
| `feature/job-master` | `28e4e47c7fc3cbfbbb1f671986efe17862636f26` | 2026-07-03 | 「岗位大师」不在 51 张原稿与推进方案内，属岗位类、受许可证约束（三方同意删） |
| `feature/kiosk-ai-os-prototype-sync` | `e0f7ca4e2be344f89ae913081351fed557372fa5` | 2026-08-04 | 7 月旧原型截图；旧原型 HTML 已保留在 docs/design，首页已被青序流光取代（三方同意删） |
| `feature/payment-c5-6-refund-regression-gate` | `faec754bee8da54af484e8082c3213d85044404f` | 2026-07-12 | 和后面的 v2 重复；回归脚本已在基线，SOP 留在 v2 |
| `fix/contract-review-ci-20260804` | `38e564f9e4f84180fc113b7ab5ee74d7d7c27b95` | 2026-08-04 | 合同审查 CI 修复已随后续 main 收口 |
| `fix/dep-advisories-multer-2.3.0` | `072f9a0efae3518de12dedfc965ac4d3e5069910` | 2026-09-09 | multer 版本修复已在基线 |
| `fix/grok-cred-hardening-20260903` | `19f09a9a1e9965aacbfb38a4599d648c7cb393ac` | 2026-09-03 | 名是凭证加固，独有文件实为旧页面/图谱稿，基线已有后续版，也没有 GROK 密钥改动 |
| `fix/kiosk-pickup-claim-title` | `9059ef97c9822052010bfc285ad9d89782402a6f` | 2026-08-19 | 「到机码核销」已在基线大量出现 |
| `fix/login-keypad-finding` | `dfefbee50e689bef7d835ea7017a9f5833bdba50` | 2026-08-16 | 只剩说明文字，键盘修复已随后续取件页演进 |
| `fix/main-red-after-833` | `c4110e3f966bfb4e543d834171e387a34c4074ba` | 2026-09-06 | CI 变红后的修补，main 后续已经过 |
| `fix/printer-heartbeat-ready-v2` | `4281d34e29d832936348d4f5c4dd1d4459a40e3a` | 2026-07-17 | 只剩进度记 |
| `fix/self-assessment-staged-cleanup-r3` | `f7d36064bb01eecbd26d1d918ebbadb147913d0e` | 2026-08-02 | 合规 §4.6.4 已在基线，其余是审查过程稿 |
| `ops/close-unpaid-runbook-20260725` | `e03afe2f425d584f49d9d9ce29309596d51a5c00` | 2026-07-25 | 独有文件的字节曾在基线历史里，已被后续版本取代 |

## 保留（27 个，另有 7 个受保护分支）

受保护：`main`、整合分支 `codex/commercial-integration-20260918-r1`、`backup/commercial-closeout-candidate-20260925`、待抽取的 `chore/walkthrough-harness`、`feat/qx-batch-help`、`codex/b1-r1-pm2-mode-20260825`、`codex/windows-agent-online-update`。下面 27 个有未被基线吸收的内容，等对应步骤用完或判定后再清。

| 分支 | 日期 | 留下的内容 | 对应步骤 |
| --- | --- | --- | --- |
| `chore/deadpages` | 2026-09-10 | 要删的 V6 死页里有 31 个文件基线仍在，PR 已关，算不算死代码需产品看 | 3.7 |
| `claude/miniapp-console-sharing-2026-08` | 2026-08-18 | 未吸收的治理句：删 worktree 前必须核对 cwd，路径统一到 .worktrees/；渠道字段迁移则已在基线 | — |
| `claude/miniapp-lane` | 2026-09-03 | 43 个提交从未开 PR；招聘会/简历页基线已有另一版，行级对不上 | 小程序分路 |
| `claude/partner-account-settings` | 2026-07-14 | 合作机构后台的账号设置/改密页，两个基线都没有这条路由 | — |
| `claude/professional-circle-plan-review-dc97b4` | 2026-08-17 | 市场验证后的战略修订（含数据不出域）不在两个基线 | — |
| `claude/recursing-tu-8ebb65` | 2026-08-04 | 材料包 Bundle 接口和公开终端列表，两个基线都没有 bundles 模块 | — |
| `claude/user-self-refund-a3-s3` | 2026-08-16 | 会员自助退款端点不在基线，PR #632 已关，开不开需产品定 | 1.11 |
| `codex/bos-storage-adapter` | 2026-08-10 | 百度 BOS 适配器和切换文档不在基线，现用 COS/本地，PR 已关 | R-04 |
| `codex/dual-device-collaboration-docs` | 2026-07-06 | 双机协同规则写进协作说明和打印验收包，基线没有这段 | — |
| `codex/governance-safety-20260822` | 2026-08-22 | 改了发布/备份脚本和治理说明，没有 PR，和现行门禁是否重复不清楚 | 1.6 |
| `codex/job-fit-anonymous-consent-ui-fix-20260712` | 2026-07-13 | 岗位匹配的匿名授权弹窗和规格不在基线，页面本身在 | 3.5 |
| `codex/payment-code-privacy-20260811` | 2026-08-16 | 公共终端付款码遮挡的验证句不在基线，页面文件在，PR 已关 | 3.5 / 2.4 |
| `codex/pickup-terminal-auth-20260910` | 2026-09-10 | 取件请求鉴权和防重放，PR #1035 已关，和基线现有取件页是否同一套不清楚 | 1.3 / 1.4 |
| `codex/prelaunch-stabilization-20260811` | 2026-08-11 | 上传鉴权和体积限制的收紧不在基线原文里，PR 已关 | 1.1 |
| `codex/remove-fake-pickup-claim-20260811` | 2026-08-11 | 「去掉假取件」改了 19 个文件，基线只有零星「假取件」字样，对不上 | 1.4 / 3.7 |
| `codex/storage-delete-retry-20260811` | 2026-08-11 | 对象删除重试的数据库迁移两个基线都没有 | — |
| `codex/windows-agent-burn-exe` | 2026-08-07 | Burn EXE 安装器候选不在已保留的在线更新分支里，还要不要这条安装路径未定 | 4.2 |
| `codex/windows-agent-same-version-gate` | 2026-09-04 | 同版本恢复闸门脚本 test-exe-same-version-transition.ps1 两个基线都没有 | — |
| `docs/delivery-refresh-0910` | 2026-09-10 | 把交付包 BL-05（OCR 密钥）从 OPEN 改为 CLOSED 并写了取证边界，基线仍是 OPEN | — |
| `feat/kiosk-pii-redaction-contract` | 2026-08-09 | 隐私遮挡四步交互契约的原句不在基线，遮挡代码本身在 | 3.5 |
| `feat/payment-c5-6-verify-gate-v2` | 2026-07-17 | 退款对账 SOP 不在基线；回归脚本本身已经在 | — |
| `feat/pii-redaction-text-layer` | 2026-08-09 | 隐私遮挡文字层的 finding boxes 迁移两个基线都没有 | — |
| `feature/id-photo-design` | 2026-07-13 | 证件照类型 idPhoto.ts 和实现不在两个基线，PR 已关 | 2.4 |
| `field/windows-phase-f-2026-09` | 2026-09-06 | 现场结论：Agent 领取遇到 HTTP 429、延迟约 4 分钟，两个基线的进度文档都没有 | — |
| `fix/p1-money-rebase` | 2026-09-06 | 入账守取件窗口、关单回滚 claimed、出码失败释放锁，基线没有这段 | — |
| `fix/partner-stats-empty-state` | 2026-08-03 | 合入后补的两份 G1/下一步审查结论不在基线，是否还有未关风险不清楚 | 3.8 |
| `team/audit-p9-truncation` | 2026-09-06 | 列表不再静默截断（标明 truncated），基线没有 verify-list-truncation-honesty.ts | — |
