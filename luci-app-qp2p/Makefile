# SPDX-License-Identifier: MIT

include $(TOPDIR)/rules.mk

# menuconfig 走 ncurses，构建机 LANG 不是 UTF-8 时中文会显示成乱码，
# 所以这两个字段只用 ASCII；网页里的标题和说明仍然是中文（浏览器按 UTF-8 渲染）。
LUCI_TITLE:=LuCI support for qp2p
LUCI_DESCRIPTION:=Web UI for the qp2p mesh VPN: overview, settings and log
LUCI_DEPENDS:=+luci-base +qp2p
LUCI_PKGARCH:=all

PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=lucien

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
