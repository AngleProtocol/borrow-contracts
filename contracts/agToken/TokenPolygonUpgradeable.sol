// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";

interface IChildToken {
    function deposit(address user, bytes calldata depositData) external;
    function withdraw(uint256 amount) external;
}

contract TokenPolygonUpgradeable is Initializable, ERC20Upgradeable, AccessControlUpgradeable, EIP712Upgradeable, IChildToken {
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    /// @dev emitted when the child chain manager changes
    event ChildChainManagerAdded(address newAddress);
    event ChildChainManagerRevoked(address oldAddress);

    constructor() initializer {}

    function initialize(string memory _name, string memory _symbol, address childChainManager, address guardian) public initializer {
        __ERC20_init(_name, _symbol);
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, guardian);
        _setupRole(DEPOSITOR_ROLE, childChainManager);
        __EIP712_init(_name, "1");
    }

    /**
     * @notice called when the bridge has tokens to mint
     * @param user address to mint the token to
     * @param depositData encoded amount to mint
     */
    function deposit(address user, bytes calldata depositData)
        external
        override
    {
        require(hasRole(DEPOSITOR_ROLE, msg.sender));
        uint256 amount = abi.decode(depositData, (uint256));
        _mint(user, amount);
    }

    /**
     * @notice called when user wants to withdraw tokens back to root chain
     * @dev Should burn user's tokens. This transaction will be verified when exiting on root chain
     * @param amount amount of tokens to withdraw
     */
    function withdraw(uint256 amount) override external {
        _burn(_msgSender(), amount);
    }
}
