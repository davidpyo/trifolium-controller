import React from "react";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

// A button that asks which kind before it acts.
//
// Save, Load and Write each have three meanings here - device settings, one profile slot, or the
// whole device - and they are not interchangeable: the two stores are separate commands with
// separate schema versions, and writing the active profile reboots the blaster while writing an
// inactive one does not. A single button labelled "Save" has to pick one silently, which is the
// easiest mistake to make in a tool like this. Naming the choice up front costs one click.

export interface MenuAction {
  /** "-" renders a divider instead of an item, which is the one case with nothing to click. */
  label: string;
  /** Shown under the label - what this one actually touches, or why it is unavailable. */
  detail?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface MenuButtonProps {
  label: string;
  actions: MenuAction[];
  disabled?: boolean;
  tooltip?: string;
  color?: "inherit" | "primary" | "secondary" | "warning" | "error";
  variant?: "text" | "outlined" | "contained";
  sx?: object;
}

export function MenuButton({
  label,
  actions,
  disabled,
  tooltip,
  color,
  variant = "outlined",
  sx,
}: MenuButtonProps) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title={tooltip ?? ""}>
        <span style={{ display: "flex", flex: 1 }}>
          <Button
            size="small"
            fullWidth
            variant={variant}
            color={color}
            disabled={disabled}
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={sx}
          >
            {label} &#x25BE;
          </Button>
        </span>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {actions.map((action, i) =>
          action.label === "-" ? (
            <Divider key={`sep-${i}`} />
          ) : (
            <MenuItem
              key={action.label}
              disabled={action.disabled}
              onClick={() => {
                setAnchor(null);
                action.onClick?.();
              }}
              sx={{ py: 0.5 }}
            >
              <ListItemText
                primary={<Typography variant="body2">{action.label}</Typography>}
                secondary={
                  action.detail ? (
                    <Typography variant="caption" color="text.secondary">
                      {action.detail}
                    </Typography>
                  ) : null
                }
              />
            </MenuItem>
          ),
        )}
      </Menu>
    </>
  );
}
