# personas.json 字段说明

数据集 v2 人设。基准日 `asOf` 是 `2026-09-29`，年龄按这一天的周岁计算。全部虚构，规则见同目录 `PERSONAS.md` 第 0 节。

校验：`node scripts/walkthrough/dataset/check-personas.mjs`

## 根对象

| 字段 | 含义 |
|---|---|
| schemaVersion | 结构版本，当前为 2 |
| asOf | 年龄基准日，`YYYY-MM-DD` |
| description | 这段数据是什么 |
| phoneRange | 本批手机号起止，闭区间 |
| sites | 4 个网点 |
| personas | 28 个人，每人一条 |

## sites[]

| 字段 | 含义 |
|---|---|
| id | `service-hall` / `gig-home` / `campus` / `community` |
| name | 网点：服务大厅、零工之家、高校就业中心、社区服务站 |
| org | 示例机构名，必须带「示例」 |
| terminal | `WALK-001` 至 `WALK-004` |
| traits | 这个网点的人流特点，供走查排期用 |

## personas[]

| 字段 | 含义 |
|---|---|
| id | 稳定编号，`p` 加手机号后三位，如 `p601` |
| name | 姓名。虚构，可以有生僻字、复姓和间隔号「·」。不得含「测试」 |
| age | 周岁，与 `birthDate`、证件号里的出生日期、`asOf` 一致 |
| gender | `男` 或 `女`。证件号顺序码奇数男、偶数女 |
| phone | 11 位，`13800000601` 起连续到 `13800000628` |
| birthDate | `YYYY-MM-DD` |
| idNumber | 18 位。前 6 位固定 `370200`。第 7–14 位等于出生日期。第 18 位按 GB 11643-1999 计算，可以是 `X`。本批至少 3 个末位 `X` |
| siteId | 对应 `sites[].id` |
| cohort | 人群，如应届生、返乡务工、宝妈再就业 |
| deviceSkill | `高` / `中` / `低` / `不会触屏` |
| hasSmartphone | 有没有智能手机。有手机不等于会用它传文件 |
| smartphoneNote | 可选。手机怎么用、什么系统 |
| carried.kinds | 带到机器前的东西：`纸质`、`U盘`、`微信文件`、`手机相册`、`没带`。可以多选 |
| carried.detail | 具体带了什么、文件有多乱 |
| goal | 这个人这次要办成什么 |
| habits.misclickRate | 点错率，0 到 1 |
| habits.leaveMidwayProbability | 中途走开的概率，0 到 1 |
| habits.whenConfused | 看不懂提示时会做什么 |
| habits.patienceMinutes | 愿意在机器前耗的分钟数 |
| habits.asksStaff | 会不会主动找工作人员 |
| isMember | 是否已经注册会员 |
| features | 这个人会用到的功能。不得出现「一键投递」「立即投递」「平台投递」「企业收简历」「候选人管理」 |

证件号校验：前 17 位分别乘以 `7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2`，和对 11 取余，对照 `1,0,X,9,8,7,6,5,4,3,2`。

素材不在这个文件里。生成脚本是 `gen-files.mjs`，文件和 `manifest.json` 写到 `~/.cache/walk0929/dataset/files/`。
